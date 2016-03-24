"use strict";

const fs = require('fs');
const cluster = require('cluster');
const uuid = require('node-uuid');
const readline = require('readline');
const util = require('util');
const ioc = require('socket.io-client');
const redis = require('redis').createClient;

var loop = function(interval, count, func) {
    var i = 0;
    var again = function() {
        func();
        if (++i < count) {
            setTimeout(again, interval);
        }
    };
    again();
};

module.exports = function(options) {
    if (cluster.isMaster) {
        for (var i = 0; i < options.worker; i++) {
            cluster.fork();
        }

        //获得字符串实际长度，中文2，英文1
        //控制台中中文占用2个英文字符的宽度
        var getDisplayLength = function(str) {
            var realLength = 0,
                len = str.length,
                charCode = -1;
            for (var i = 0; i < len; i++) {
                charCode = str.charCodeAt(i);
                if (charCode >= 0 && charCode <= 128) realLength += 1;
                else realLength += 2;
            }
            return realLength;
        };

        //计算一个字符串在当前控制台中占用的行数和列数信息
        //outputStream.rows及outputStream.columns属性为当前控制台的显示的窗口的大写
        var getStrOccRowColumns = function(str) {
            var consoleMaxRows = outputStream.rows;
            var consoleMaxColumns = outputStream.columns;
            var strDisplayLength = getDisplayLength(str);
            var rows = parseInt(strDisplayLength / consoleMaxColumns, 10);
            var columns = parseInt(strDisplayLength - rows * consoleMaxColumns, 10);

            return {
                rows: rows,
                columns: columns
            }
        };

        var redisClient = options.redis ? redis({
            "host": options.redis,
            "port": 6379
        }) : null;
        var inputStream = process.stdin,
            outputStream = process.stdout,
            rl = readline.createInterface({
                input: inputStream,
                output: outputStream,
                terminal: true
            }),
            users = [],
            record = {
                io: {
                    create: 0,
                    connect: 0,
                    disconnect: 0,
                    reconnect: 0,
                    error: 0
                },
                message: {},
                error: {},
                sockets: {},
                loadEnd: false,
                outputMessage: false
            },
            cursorDx = 0,
            cursorDy = 0,
            dxInfo = 0;

        //修改打印
        console.log = function(outputContent, replace, print) {
            if (!options.message && !print) return;
            if (!replace) {
                outputStream.write(outputContent + '\r\n');
                rl.close();
            } else {
                readline.moveCursor(outputStream, cursorDx * -1, cursorDy * -1);
                readline.clearScreenDown(outputStream);
                outputStream.write(outputContent);
                dxInfo = getStrOccRowColumns(outputContent);
                cursorDx = dxInfo.columns;
                cursorDy = dxInfo.rows;
            }
        }

        //消息接收完毕
        function messageOutputEnd(mid, over) {
            delete record.message[mid].time;
            console.log('\r\n' + (over ? '接收完毕' : '超时接收') + ':' + JSON.stringify(record.message[mid]));
            console.log('>-------------------------------------------------------------------------<\r\n');
            record.outputMessage = false;
            rl.close();

            process.nextTick(function() {
                if (options.output) {
                    let data = JSON.parse(fs.readFileSync(options.output, 'utf8') || '[]');
                    data.push(record.message[mid]);
                    fs.writeFileSync(options.output, JSON.stringify(data, null, 4));
                }
                record.message[mid] = null;
                delete record.message[mid];

                if (redisClient) {
                    //10秒后 从redis中删除数据
                    setTimeout(() => {
                        users.forEach(function(uid) {
                            redisClient.del(util.format('msg@%s@%s', mid, uid))
                        });
                    }, 10 * 1000);
                }
            });
        }

        Object.keys(cluster.workers).forEach(function(id) {
            cluster.workers[id].on('message', function(obj) {
                switch (obj.type) {
                    case 'create':
                        if (record.io.create === 0) console.log('开始创建socket.io客户端', false, true);
                        console.log(util.format('创建数量:%s 个连接', ++record.io.create), true, true);
                        if (record.io.create === options.amount) {
                            console.log('\r\n创建完毕', false, true);
                            console.log(record.io.create + '个客户端正在连接进服务器,当前连接数:' + Object.keys(record.sockets).length, true, true);
                        }
                        break;
                    case 'connect':
                        ++record.io.connect;
                        record.sockets[obj.id] = 0;
                        if (users.indexOf(obj.uid) === -1) users.push(obj.uid); //存储用户
                        if (record.io.create === options.amount) {
                            if (!record.loadEnd) {
                                console.log(record.io.create + '个客户端正在连接进服务器,当前连接数:' + Object.keys(record.sockets).length, true, true);
                                if (record.io.create === Object.keys(record.sockets).length) {
                                    record.loadEnd = true;
                                    console.log('\r\n' + record.io.create + '个客户端全部连接上服务器', false, true);
                                    console.log(JSON.stringify(record.io));
                                    if (Object.keys(record.error).length) {
                                        console.log('\r\n错误信息:' + JSON.stringify(record.error));
                                    }
                                }
                            } else if (!record.outputMessage) {
                                console.log('重连:' + JSON.stringify(record.io), true, true);
                            }
                        }
                        break;
                    case 'disconnect':
                        ++record.io.disconnect;
                        if (users.indexOf(obj.uid) !== -1) users.splice(users.indexOf(obj.uid), 1); //移除用户
                        if (typeof(record.sockets[obj.id]) !== 'undefined') {
                            delete record.sockets[obj.id];
                        } else {
                            ++record.io.connect;
                        }
                        if (record.io.create === options.amount) {
                            if (!record.loadEnd) {
                                console.log(record.io.create + '个客户端正在连接进服务器,当前连接数:' + Object.keys(record.sockets).length, true, true);
                            } else if (!record.outputMessage) {
                                console.log('断线:' + JSON.stringify(record.io), true, true);
                            }
                        }
                        break;
                    case 'reconnect':
                        ++record.io.reconnect;
                        break;
                    case 'error':
                        ++record.io.error;
                        if (!record.error[obj.body.type]) {
                            record.error[obj.body.type] = {
                                description: obj.body.description,
                                count: 1
                            };
                        } else {
                            record.error[obj.body.type].count++;
                        }
                        break;
                    case 'message':
                        let mid = obj.body[0],
                            msg = obj.body[1],
                            time = obj.body.length === 3 ? (Date.now() - obj.body[2]) : null;

                        record.outputMessage = true;

                        if (!record.message[mid]) {
                            record.message[mid] = {
                                mid: mid,
                                count: 0,
                                min: 10000000,
                                max: 0,
                                client: Object.keys(record.sockets).length,
                                time: null
                            }
                            console.log('\r\n>-------------------------------------------------------------------------<');
                            console.log('开始接收信息,当前在线人数:' + record.message[mid].client);
                        }
                        record.message[mid].count++;
                        record.message[mid].max = Math.max(record.message[mid].max, time);
                        record.message[mid].min = Math.min(record.message[mid].min, time);
                        console.log(util.format('已经成功接收 %s 条信息', record.message[mid].count), true);
                        clearTimeout(record.message[mid].time);
                        if (record.message[mid].count === record.message[mid].client) {
                            messageOutputEnd(mid, true);
                        } else {
                            record.message[mid].time = setTimeout(messageOutputEnd.bind(null, mid, false), options.time);
                        }
                        break;
                }
            });
        });
    } else {
        loop(1000, options.amount / options.concurency / options.worker, function() {
            loop(1000 / options.concurency, options.concurency, function() {
                var id = process.pid + '_' + uuid.v1(),
                    socket = ioc(options.path),
                    socketID = socket.id;

                socket.on('connect', function() {
                    socketID = socket.id;
                    process.send({
                        id: socketID,
                        uid: id,
                        type: 'connect'
                    });
                    socket.emit('login', id);
                });
                socket.on('disconnect', () => process.send({
                    id: socketID,
                    uid: id,
                    type: 'disconnect'
                }));
                socket.on('reconnect', () => {
                    socketID = socket.id;
                    process.send({
                        id: socketID,
                        type: 'reconnect'
                    });
                });
                socket.on('error', (err) => process.send({
                    type: 'error',
                    body: err
                }));
                socket.on('message', function(mid, msg, time, next) {
                    process.send({
                        type: 'message',
                        body: [mid, msg, time]
                    });
                    if (next) next();
                });

                process.send({
                    type: 'create'
                });
            });
        });
    }
};
