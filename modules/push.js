"use strict";

const util = require('util');
const io = require('socket.io');
const ior = require('socket.io-redis');
const iop = require('socket.io-parser');
const msgpack = require('msgpack-js');
const api = require('./api.js');
const config = require('../config.json');


module.exports = {
    /**
     * 创建socket.io服务
     * @param  {[type]} server http
     */
    create: function(server) {
        this.ioRedis = ior(config.redis, {
            key: config.io.key
        });
        this.redis = this.ioRedis.pubClient;

        this.io = io(server, config.io.options);
        this.io.adapter(this.ioRedis);
        this.io.of(config.io.nsp).use(this.handshake).on('connection', this.connection.bind(this));

        //扩展redis消息订阅
        this.transformMesssage();
    },
    /**
     * 连接信息检测处理
     * @param  {[type]}   socket [description]
     * @param  {Function} next   [description]
     */
    handshake: function(socket, next) {
        //连接信息检测
        return next();
    },
    /**
     * 建立连接处理
     * @param  {[type]} socket [description]
     */
    connection: function(socket) {
        //扩展socket
        this.transformSocket(socket);

        //登录
        socket.on('login', (uid) => {
            let uuid = null;

            //当前socket连接已经被使用
            if (socket.heikuai && uid !== (uuid = socket.heikuai.uid)) {
                //注销账号
                this.logout(socket);
            }

            //不是重复登录
            if (uid !== uuid) {
                //登录账号
                this.login(socket, uid);
            }
        });

        //注销
        socket.on('logout', this.logout.bind(this, socket));

        //断开连接
        socket.on('disconnect', () => {
            //注销
            this.logout(socket);
            //清理
            this.io.sockets[socket.id] = null;
            this.io.sockets.sockets[socket.id] = null;
        });

        //错误处理
        socket.on('error', function(err) {
            console.error('socket.io error', err);
        });
    },
    /**
     * 登录
     * @param  {[type]} socket [description]
     * @param  {[type]} uid    用户编号
     */
    login: function(socket, uid) {
        //保存用户信息
        socket.heikuai = {
            uid: uid,
            tags: []
        };

        //用socket.id创建一个单独房间
        //socket新建时已经创建了这个房间 因为 注销或者重复登录 把它给移除了
        socket.join(socket.id);
        // if (config.io.nsp != '/') socket.join('/' + socket.id.replace(config.io.nsp, ''));
        //用uid创建一个独立房间
        socket.join(uid);
        //查询分组信息 并加入分组
        this.redis.get(util.format('room@%s', uid), (err, reply) => {
            if (err) console.error(err);

            //如果没有查询到数据 说明没有分组信息
            if (reply && socket.client.conn.readyState == 'open') {
                reply.split(config.separator).forEach((room) => {
                    if (room) {
                        socket.join(room);
                        //把房间定义为标签 tag 存入socket.heikuai.tags中
                        socket.heikuai.tags.push(room);
                        //把标签格式化数据存入到redis中 方便后台查询
                        this.redis.set(util.format('tag@%s@%s', room, uid), '');
                    }
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
                this.redis.publish(util.format('login%s@*', Math.floor(Math.random() * config.serversNumber) + 1), uid);
            }
        });
    },
    /**
     * 注销
     * @param  {[type]} socket [description]
     */
    logout: function(socket) {
        if (socket.heikuai) {
            let socketID = socket.id;
            //删除记录
            this.redis.get(util.format('user@%s', socket.heikuai.uid), (err, reply) => {
                if (err) console.error(err);
                if (socketID === reply) {
                    this.redis.del(util.format('user@%s', socket.heikuai.uid));
                    //同时移除标签信息
                    socket.heikuai.tags.forEach((tag) => {
                        this.redis.del(util.format('tag@%s@%s', tag, socket.heikuai.uid));
                    });
                }
                socket.heikuai = null;
            });
            //离开所有房间
            socket.leaveAll();
        }
    },
    /**
     * 重复登录
     * @param  {[type]} socket [description]
     */
    repeat: function(socket) {
        if (socket.heikuai) {
            socket.leaveAll(); //离开所有房间
            socket.heikuai = null;
        }
    },
    /**
     * 切换房间
     * @param  {[type]} socket [description]
     * @param  {[type]} packet 切换房间信息
     */
    changeRoom: function(socket, packet) {
        let msg = packet.data[2];
        if (socket.heikuai) {
            if (msg.joins) {
                msg.joins.split(config.separator).forEach((room) => {
                    if (room && socket.heikuai.tags.indexOf(room) === -1) {
                        socket.join(room); //加入房间
                        socket.heikuai.tags.push(room); //存储标签
                        this.redis.set(util.format('tag@%s@%s', room, socket.heikuai.uid), ''); //存储标签
                    }
                });
            }

            if (msg.leaves) {
                msg.leaves.split(config.separator).forEach((room) => {
                    let index;
                    if (room && (index = socket.heikuai.tags.indexOf(room)) !== -1) {
                        socket.leave(room); //离开房间
                        socket.heikuai.tags.splice(index, 1); //移除标签
                        this.redis.del(util.format('tag@%s@%s', room, socket.heikuai.uid)); //移除标签
                    }
                });
            }
        }
    },
    /**
     * 获取socket对象
     * @param  {[type]}   rooms    [description]
     * @param  {[type]}   except   [description]
     * @param  {[type]}   packet   [description]
     * @param  {Function} callback [description]
     */
    getSocketByEmitMsg: function(rooms, except, packet, callback) {
        //如果设置了 nsp
        //this.io.scokets.adapter 更改为 this.io.nsps[config.io.nsp].adapter
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
    transformMesssage: function() {
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
                //切换分组
                this.getSocketByEmitMsg(rooms, except, packet, this.changeRoom.bind(this));
            } else if (packet.data[0] === 'repeat' && packet.data[1] == '-1') {
                //重复登录
                this.getSocketByEmitMsg(rooms, except, packet, this.repeat.bind(this));
            }
        });
    },
    /**
     * 扩展socket的packet方法 添加ack
     * @param  {[type]} socket [description]
     */
    transformSocket: function(socket) {
        let _this = this;
        //修改packet函数
        socket.packet = function(packet, opts) {
            if (this.client.conn.readyState == 'open') {
                opts = opts || {};
                opts.compress = false !== opts.compress;

                //使用ocket.io-emitter 发送的消息是被socket.io-parser编码过的
                if (opts.preEncoded && socket.heikuai) {
                    if (process.env.NODE_ENV !== 'development') {
                        //方案一 拼接字符串
                        this.client.packet(_this.packetCloneStr(packet, socket), opts);
                    } else {
                        //方案二 解码并添加属性 (测试环境才使用)
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
     * @param  {[type]}   encodedPackets 编码的消息
     * @param  {Function} callback       回调函数
     */
    packetDecode: function(encodedPackets, callback) {
        var decoder = new iop.Decoder();
        decoder.on('decoded', function(decodedPacket) {
            decoder.destroy();
            callback(decodedPacket);
        });
        for (var i = 0; i < encodedPackets.length; i++) {
            decoder.add(encodedPackets[i]);
        }
    },
    /**
     * 创建ack
     * @param  {[type]} socket [description]
     * @param  {[type]} mid    消息编号
     * @return {[type]}        ack编号
     */
    createAck: function(socket, mid) {
        let _this = this,
            uid = socket.heikuai.uid,
            key = socket.nsp.ids;
        socket.nsp.ids++;

        //添加ack
        socket.acks[key] = function() {
            //消息接收成功
            _this.redis.set(util.format('msg@%s@%s', mid, uid), '');

            //清理
            socket.acks[key] = null;
            delete socket.acks[key];
        }

        return key;
    },
    /**
     * 克隆消息包
     * @param  {[type]} packet [description]
     * @param  {[type]} socket [description]
     * @return {[type]}        [description]
     */
    packetCloneObj: function(packet, socket) {
        //只有事件名为‘message’才添加回调
        if (packet.data[0] === 'message') {
            //把ack添加进数据包
            packet.id = this.createAck(socket, packet.data[1]);
            //测试环境 追加额外参数 发送消息时的服务器时间
            packet.data.push(Date.now());
        }
        return packet;
    },
    /**
     * 克隆消息包
     * @param  {[type]} packet [description]
     * @param  {[type]} socket [description]
     * @return {[type]}        [description]
     */
    packetCloneStr: function(packet, socket) {
        //通过正则解析packet 获取事件名和消息编号
        let _packet = packet[0],
            _data = _packet.substring(_packet.indexOf('[')),
            arr = _data.match(/^\["([\S]*?)","([\S]*?)"/);
        //只有事件名为‘message’才添加回调
        if (arr && arr.length >= 3 && arr[1] === 'message') {
            //把ack添加进数据包
            _packet = _packet[0] + (config.io.nsp === '/' ? '' : config.io.nsp + ',') + this.createAck(socket, arr[2]) + '["message' + _data.match(/^\["message([\s\S]*?)$/)[1];
        }
        return [_packet];
    }
};
