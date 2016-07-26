"use strict";

import util from 'util';
import io from 'socket.io';
import ior from 'socket.io-redis';
import iop from 'socket.io-parser';
import msgpack from 'msgpack-js';
import api from './api';
import config from '../config.json';

export default {
    /**
     * 创建socket服务
     * @param server [http server]
     */
    create: function (server) {
        this.ioRedis = ior(config.redis, {
            key: config.io.key
        });
        this.redis = this.ioRedis.pubClient;

        this.io = io(server, config.io.options);
        this.io.adapter(this.ioRedis);
        this.io.of(config.io.nsp).use(this.handshake).on('connection', this.connection.bind(this));

        //扩展redis消息订阅
        this.transformMessage();
    },
    /**
     * socket连接信息处理过滤
     * @param socket
     * @param next
     * @returns {*}
     */
    handshake: function (socket, next) {
        return next();
    },
    /**
     * 建立连接处理
     * @param socket
     */
    connection: function (socket) {
        //扩展socket
        this.transformSocket(socket);

        //登录
        socket.on('login', (uid) => {
            //当前socket连接已经被使用
            if (socket.heikuai) {
                this.logout(socket); //注销账号
            }

            this.login(socket, uid);  //登录账号
        });

        let logout = this.logout.bind(this, socket);

        //注销
        socket.on('logout', logout);

        //断开连接
        socket.on('disconnect', logout);

        //错误处理
        socket.on('error', function (err) {
            console.error('socket.io error', err);
        });
    },
    /**
     * 登录
     * @param  {[type]} socket [description]
     * @param  {[type]} uid    用户编号
     */
    login: function (socket, uid) {
        //保存用户信息
        socket.heikuai = {
            uid: uid,
            tags: []
        };

        //用socket.id创建一个单独房间
        //socket新建时已经创建了这个房间 因为 注销或者重复登录 把它给移除了
        socket.join(socket.id);
        //用uid创建一个独立房间
        socket.join(uid);
        //查询分组信息 并加入分组
        this.redis.get(util.format('room@%s', uid), (err, reply) => {
            if (err) console.error(err);

            //如果没有查询到数据 说明没有分组信息
            if (reply && socket.client.conn.readyState == 'open' && socket.heikuai && socket.heikuai.tags) {
                //把房间定义为标签 tag 存入socket.heikuai.tags中
                socket.heikuai.tags = reply.split(config.separator).map(function (room) {
                    socket.join(room); //加入房间
                    return room;
                });
            }
        });

        //查询用户是否登录 并 存储用户信息
        this.redis.get(util.format('user@%s', uid), (err, reply) => {
            if (err) console.error(err);
            //重复登录
            if (reply && reply !== socket.id) {
                api.pushMsgToSingleDevice(reply, '-1', util.format('用户 %s 重复登录', uid), 'repeat');
            }
            if (socket.client.conn.readyState == 'open') {
                //更新用户信息
                this.redis.set(util.format('user@%s', uid), socket.id);
                //推送用户登录消息 如果是多台服务器就随机分配服务器
                this.redis.publish(util.format('login%s@*', Math.floor(Math.random() * config.serverNumber) + 1), uid);
            }
        });
    },
    /**
     * 注销
     * @param  {[type]} socket [description]
     */
    logout: function (socket) {
        if (socket.heikuai) {
            if (socket.heikuai.uid) this.redis.del(util.format('user@%s', socket.heikuai.uid)); //删除在线记录
            socket.heikuai = null;
        }
        socket.leaveAll(); //离开所有房间
    },
    /**
     * 重复登录
     * @param  {[type]} socket [description]
     */
    repeat: function (socket) {
        if (socket.heikuai) socket.heikuai = null;
        socket.leaveAll(); //离开所有房间
    },
    /**
     * 切换房间
     * @param  {[type]} socket [description]
     * @param  {[type]} packet 切换房间信息
     */
    changeRoom: function (socket, packet) {
        if (socket.heikuai && socket.heikuai.tags) {
            let msg = packet.data[2];
            if (msg.joins) {
                msg.joins.split(config.separator).forEach((room) => {
                    if (room && socket.heikuai.tags.indexOf(room) === -1) {
                        socket.join(room); //加入房间
                        socket.heikuai.tags.push(room); //存储标签
                    }
                });
            }

            if (msg.leaves) {
                let index;
                msg.leaves.split(config.separator).forEach((room) => {
                    if (room && (index = socket.heikuai.tags.indexOf(room)) !== -1) {
                        socket.leave(room); //离开房间
                        socket.heikuai.tags.splice(index, 1); //移除标签
                    }
                });
            }
        }
    },
    /**
     * 获取socket对象
     * @param rooms
     * @param except
     * @param packet
     * @param callback
     */
    getSocketByEmitMsg: function (rooms, except, packet, callback) {
        //因为设置了nsp,this.io.sockets.adapter 更改为 this.io.nsps[config.io.nsp].adapter
        let ids = {};
        for (let i = 0; i < rooms.length; i++) {
            let room = this.io.nsps[config.io.nsp].adapter.rooms[rooms[i]];
            if (!room) continue;
            let sockets = room.sockets;
            for (let id in sockets) {
                if (sockets.hasOwnProperty(id)) {
                    if (ids[id] || ~except.indexOf(id)) continue;
                    let socket = this.io.nsps[config.io.nsp].adapter.nsp.connected[id];
                    if (socket) {
                        callback(socket, packet);
                    }
                }
            }
        }
    },
    /**
     * 扩展redis消息订阅
     */
    transformMessage: function () {
        this.ioRedis.subClient.on('message', (channel, msg) => {
            var args = msgpack.decode(msg);
            var packet, rooms, except;

            //ignore same uid
            if (this.ioRedis.uid == args.shift()) return;

            packet = args[0];
            rooms = args[1].rooms || [];
            except = args[1].except || [];

            if (packet && packet.nsp === undefined) {
                packet.nsp = '/';
            }

            //ignore different namespace
            if (!packet || packet.nsp != config.io.nsp) return;

            if (packet.data[0] === 'changeRoom' && packet.data[1] == '-2') {
                this.getSocketByEmitMsg(rooms, except, packet, this.changeRoom.bind(this)); //切换分组
            } else if (packet.data[0] === 'repeat' && packet.data[1] == '-1') {
                this.getSocketByEmitMsg(rooms, except, packet, this.repeat.bind(this)); //重复登录
            }
        });
    },
    /**
     * 扩展socket的packet方法 添加ack
     * @param socket
     */
    transformSocket: function (socket) {
        let _this = this;
        //修改packet函数
        socket.packet = function (packet, opts) {
            if (this.client.conn.readyState == 'open') {
                opts = opts || {};
                opts.compress = false !== opts.compress;

                //使用socket.io-emitter 发送的消息是被socket.io-parser编码过的
                if (opts.preEncoded && socket.heikuai) {
                    if (process.env.NODE_ENV !== 'development') {
                        //方案一 拼接字符串
                        this.client.packet(_this.packetCloneStr(packet, socket), opts);
                    } else {
                        //方案二 解码并添加属性 因最终发送前会再次编码 所以生产环境使用方案一
                        _this.packetDecode(packet, (decodedPacket) => {
                            this.client.packet(_this.packetCloneObj(decodedPacket, socket), {
                                "preEncoded": false,
                                "volatile": opts.volatile,
                                "compress": opts.compress
                            });
                        });
                    }
                } else {
                    if (!util.isArray(packet)) packet.nsp = this.nsp.name;
                    this.client.packet(packet, opts);
                }
            }
        }
    },
    /**
     * 消息包解码
     * @param encodedPackets 编码的消息
     * @param callback       回调函数
     */
    packetDecode: function (encodedPackets, callback) {
        var decoder = new iop.Decoder();
        decoder.on('decoded', function (decodedPacket) {
            decoder.destroy();
            callback(decodedPacket);
        });
        for (var i = 0; i < encodedPackets.length; i++) {
            decoder.add(encodedPackets[i]);
        }
    },
    /**
     * 创建ack
     * @param socket    socket对象
     * @param mid       消息编号
     * @returns ack key
     */
    createAck: function (socket, mid) {
        let uid = socket.heikuai.uid,
            key = socket.nsp.ids;

        socket.nsp.ids++;

        //添加ack
        socket.acks[key] = () => {
            //消息接收成功 把数据存入redis 用于验证消息是否发送成功
            this.redis.set(util.format('msg@%s@%s', mid, uid), '');
            //清理
            socket.acks[key] = null;
            delete socket.acks[key];
        };

        return key;
    },
    /**
     * 克隆消息包
     * @param packet
     * @param socket
     * @returns {*}
     */
    packetCloneObj: function (packet, socket) {
        //第一参数为是否使用ack,当该值为true or false时将修改名为 message
        if (/^(true|false)$/.test(packet.data[0])) {
            //把ack添加进数据包
            if (/^true$/.test(packet.data[0])) packet.id = this.createAck(socket, packet.data[1]);
            //把事件名进行修正
            packet.data[0] = 'message';
            //开发测试时 追加参数 消息发送时间 用于测试客户端接收延迟
            if (process.env.NODE_ENV === 'development') packet.data.push(Date.now());
        }
        return packet;
    },
    /**
     * 克隆消息包
     * @param packet
     * @param socket
     * @returns {*[]}
     */
    packetCloneStr: function (packet, socket) {
        //通过正则解析packet 获取事件名和消息编号
        let _packet = packet[0],
            _data = _packet.substring(_packet.indexOf('[')),
            _match = _data.match(/^\["([\S]*?)","([\S]*?)",([\s\S]*?)]$/);

        //第一参数为是否使用ack,当该值为true or false时将修改名为 message
        if (_match && _match.length >= 4 && /^(true|false)$/.test(_match[1])) {
            _packet = _packet[0] + (config.io.nsp === '/' ? '' : config.io.nsp + ',');
            if (/^true$/.test(_match[1])) _packet += this.createAck(socket, _match[2]);
            _packet += util.format('["message","%s",%s]', _match[2], _match[3]);
        }
        return [_packet];
    }
}
