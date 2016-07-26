"use strict";

const cluster = require('cluster');
const redis = require('redis');
const mailer = require('nodemailer');
const config = require('../config.json');

if (cluster.isMaster) {
    cluster.fork();
    //主进程负责发送邮件
    Object.keys(cluster.workers).forEach(function (id) {
        cluster.workers[id].on('message', function (res) {
            if (config.email && config.email.auth) {
                var transporter = mailer.createTransport({
                    host: "smtp.qq.com",
                    secureConnection: true,
                    port: 465,
                    auth: config.email.auth
                });
                transporter.sendMail({
                    from: config.email.from,
                    to: config.email.to,
                    subject: res.title,
                    html: res.message
                }, function (err, res) {
                    transporter.close();
                });
            }
        });
    });
} else {
    //子进程负责监听redis
    const redisClient = redis.createClient(config.redis);
    var errorCode = null;

    redisClient.on('connect', function () {
        errorCode = null;
    });
    redisClient.on('error', function (err) {
        if (errorCode != err.code) {
            errorCode = err.code;
            process.send({
                title: errorCode === 'ECONNREFUSED' ? '消息推送系统-无法连接redis服务器' : '消息推送系统-redis服务器异常',
                message: JSON.stringify(err)
            });
        }
    });
}
