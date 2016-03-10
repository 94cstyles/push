"use strict";

const util = require('util');
const route = require('koa-route');
const api = require('../modules/api.js');
const config = require('../config.json');

module.exports = function(app) {
    /**
     * 消息推送处理
     * @param  {[type]}   keys     必须参数
     * @param  {Function} callback 回调函数
     */
    function sendMessage(keys, callback) {
        var params = [];
        for (let key of keys) {
            if (util.isNullOrUndefined(this.request.body[key])) {
                return this.body = {
                    code: 1,
                    msg: "参数缺失"
                }
            }
            params.push(this.request.body[key]);
        }

        //回调
        callback.apply(this, params);

        this.body = {
            code: 0,
            msg: "发送成功"
        }
    }

    app.use(route.post('/pushMsgToSingleDevice', function*() {
        sendMessage.call(this, ['useraccount', 'msgId', 'message'], function() {
            api.pushMsgToSingleDevice.apply(api, arguments);
        });
    }));
    app.use(route.post('/pushBatchUniMsg', function*() {
        sendMessage.call(this, ['useraccounts', 'msgId', 'message'], function() {
            api.pushBatchUniMsg.apply(api, arguments);
        });
    }));
    app.use(route.post('/pushMsgToRoom', function*() {
        sendMessage.call(this, ['tags', 'msgId', 'message'], function() {
            api.pushMsgToRoom.apply(api, arguments);
        });
    }));
    app.use(route.post('/pushMsgToAll', function*() {
        sendMessage.call(this, ['msgId', 'message'], function() {
            api.pushMsgToAll.apply(api, arguments);
        });
    }));
    app.use(route.post('/pushOffLineMsg', function*() {
        sendMessage.call(this, ['useraccount', 'msglist'], function(useraccount, msglist) {
            JSON.parse(msglist).forEach(function(obj) {
                api.pushMsgToSingleDevice.call(api, useraccount, obj.msgId, obj.message);
            });
        });
    }));
    app.use(route.post('/changeRoom', function*() {
        sendMessage.call(this, ['useraccounts'], function(useraccounts) {
            if (this.request.body.joins || this.request.body.leaves) {
                //通过推送 告知scoket 分组发生改变
                api.pushBatchUniMsg.call(api, useraccounts, "-2", {
                    joins: this.request.body.joins,
                    leaves: this.request.body.leaves
                }, 'changeRoom');
            }
        });
    }));


    //测试环境 提供测试操作
    if (process.env.NODE_ENV === 'development') {
        app.use(route.get('/user/:id', function*() {
            yield this.render('index', {
                path: (config.io.path + ':' + process.env.PORT + config.io.nsp).replace('http', 'ws'),
                uid: this.request.url.replace('/user/', '')
            });
        }));

        app.use(route.get('/test', function*() {
            yield this.render('form');
        }));
    }
};
