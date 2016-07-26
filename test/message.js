"use strict";

const program = require('commander');
const request = require('request');
const uuid = require('node-uuid');

program
    .version('0.0.1')
    .option('-p, --path <url>', '广播消息接口地址')
    .option('-t, --time <n>', '消息推送间隔,默认30000ms')
    .option('-c, --count <n>', '消息推送字符数量,默认值20,实际推送20*16随机字符')
    .parse(process.argv);

if (!program.time) {
    program.time = 30000;
}

if (!program.count) {
    program.count = 20;
}

if (program.path) {
    sendMessage();
} else {
    console.error('请输入广播消息接口地址');
}

var count = 0;
function sendMessage() {
    let text = '';

    for (var i = 0; i < program.count; i++) {
        text += Math.random().toString(36).substr(2);
    }
    request.post(program.path.replace(/\/$/, '') + '/pushMsgToAll', {
        form: {
            "msgId": uuid.v1(),
            "message": text
        }
    }, function (err, res, body) {
        if (!err && res.statusCode == 200) {
            setTimeout(sendMessage, program.time);
            console.log('成功推送消息 ' + (++count) + ' 次');
        } else {
            console.log('服务崩溃发送消息失败！');
        }
    });
}