"use strict";

const util = require('util');
const fs = require('fs');
const cluster = require('cluster');
const readline = require('readline');
const uuid = require('node-uuid');
const ioc = require('socket.io-client');

/**
 * 循环
 * @param interval 间隔时间
 * @param count 次数
 * @param func 回调
 */
function loop(interval, count, func) {
    var i = 0;

    function again() {
        func();
        if (++i < count) {
            setTimeout(again, interval);
        }
    }

    again();
}


/**
 * 获得字符串实际长度，中文2，英文1
 * @param str 字符串
 * @returns {number} 长度
 */
function getDisplayLength(str) {
    var realLength = 0,
        len = str.length,
        charCode = -1;
    for (let i = 0; i < len; i++) {
        charCode = str.charCodeAt(i);
        if (charCode >= 0 && charCode <= 128) realLength += 1;
        else realLength += 2;
    }
    return realLength;
}

/**
 * /计算一个字符串在当前控制台中占用的行数和列数信息
 * @param str
 * @returns {{rows: Number, columns: Number}}
 */
function getStrOccRowColumns(str, outputStream) {
    var consoleMaxColumns = outputStream.columns;
    var strDisplayLength = getDisplayLength(str);
    var rows = parseInt(strDisplayLength / consoleMaxColumns, 10);
    var columns = parseInt(strDisplayLength - rows * consoleMaxColumns, 10);

    return {
        rows: rows,
        columns: columns
    }
}

module.exports = function (options) {
    if (cluster.isMaster) {
        for (let i = 0; i < options.worker; i++) {
            cluster.fork();
        }

        var record = {
                io: {
                    create: 0,
                    connect: 0,
                    disconnect: 0,
                    reconnect: 0,
                    error: 0
                },
                message: {},
                error: {},
                sockets: [],
                loadEnd: false,
                outputMessage: false
            },
            messageOutputEnd = function (mid, over) {
                delete record.message[mid].time;
                console.log('\r\n' + (over ? '接收完毕' : '超时接收') + ':' + JSON.stringify(record.message[mid]));
                console.log('>-------------------------------------------------------------------------<\r\n');
                record.outputMessage = false;
            };

        console.log = (function () {
            var inputStream = process.stdin,
                outputStream = process.stdout,
                cursorDx = 0,
                cursorDy = 0,
                dxInfo = null,
                rl = readline.createInterface({
                    input: inputStream,
                    output: outputStream,
                    terminal: true
                });

            return function (outputContent, replace) {
                if (!replace) {
                    outputStream.write(outputContent + '\r\n');
                    rl.close();
                } else {
                    readline.moveCursor(outputStream, cursorDx * -1, cursorDy * -1);
                    readline.clearScreenDown(outputStream);
                    outputStream.write(outputContent);
                    dxInfo = getStrOccRowColumns(outputContent, outputStream);
                    cursorDx = dxInfo.columns;
                    cursorDy = dxInfo.rows;
                }
            }
        })();


        Object.keys(cluster.workers).forEach(function (id) {
            cluster.workers[id].on('message', function (obj) {
                if (obj.type === 'create') {
                    if (record.io.create === 0) {
                        console.log('开始创建socket.io客户端', false);
                    }
                    console.log(util.format('创建数量:%s 个连接', ++record.io.create), true);
                    if (record.io.create === options.amount) {
                        console.log('\r\n创建完毕', false, true);
                        console.log(record.io.create + '个客户端正在连接进服务器,当前连接数:' + record.sockets.length, true);
                    }
                } else if (obj.type === 'connect') {
                    ++record.io.connect;
                    record.sockets.push(obj.id);
                    if (record.io.create === options.amount) {
                        if (!record.loadEnd) {
                            console.log(record.io.create + '个客户端正在连接进服务器,当前连接数:' + record.sockets.length, true);
                            if (record.io.create === record.sockets.length) {
                                record.loadEnd = true;
                                console.log('\r\n' + record.io.create + '个客户端全部连接上服务器', false);
                                console.log(JSON.stringify(record.io));
                                if (Object.keys(record.error).length) {
                                    console.log('\r\n错误信息:' + JSON.stringify(record.error));
                                }
                            }
                        } else {
                            console.log('重连:' + JSON.stringify(record.io), true);
                        }
                    }
                } else if (obj.type === 'disconnect') {
                    ++record.io.disconnect;
                    if (record.sockets.indexOf(obj.id) !== -1) {
                        record.sockets.splice(record.sockets.indexOf(obj.id), 1);
                    } else {
                        ++record.io.connect;
                    }
                    if (record.io.create === options.amount) {
                        if (!record.loadEnd) {
                            console.log(record.io.create + '个客户端正在连接进服务器,当前连接数:' + record.sockets.length, true);
                        } else if (!record.outputMessage) {
                            console.log('断线:' + JSON.stringify(record.io), true);
                        }
                    }
                } else if (obj.type === 'reconnect') {
                    ++record.io.reconnect;
                } else if (obj.type === 'error') {
                    ++record.io.error;
                    if (!record.error[obj.body.type]) {
                        record.error[obj.body.type] = {
                            description: obj.body.description,
                            count: 1
                        };
                    } else {
                        record.error[obj.body.type].count++;
                    }
                } else if (obj.type === 'message') {
                    let mid = obj.body[0],
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
                        };
                        console.log('\r\n>-------------------------------------------------------------------------<');
                        console.log('开始接收信息,当前在线人数:' + record.message[mid].client, false);
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
                }
            });
        });
    } else {
        loop(1000, options.amount / options.concurency / options.worker, function () {
            loop(1000 / options.concurency, options.concurency, function () {
                var id = process.pid + '_' + uuid.v1(),
                    socket = ioc(options.path),
                    socketID = socket.id;

                socket.on('connect', function () {
                    socketID = socket.id;
                    socket.emit('login', id);
                    process.send({
                        id: socketID,
                        uid: id,
                        type: 'connect'
                    });
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
                socket.on('message', function () {
                    process.send({
                        type: 'message',
                        body: Array.prototype.slice.call(arguments, 0)
                    });
                    if (typeof (arguments[arguments.length - 1]) == "function") arguments[arguments.length - 1]();
                });

                process.send({
                    type: 'create'
                });
            });
        });
    }
};
