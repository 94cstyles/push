"use strict";

import util from 'util';
import route from 'koa-route';
import api from '../modules/api';
import config from '../config.json';

export default function routes(app) {
    function getParams(body, keys) {
        var params = [];
        for (let key of keys) {
            if (util.isNullOrUndefined(body[key])) {
                return null;
            }
            params.push(body[key]);
        }
        if (!util.isNullOrUndefined(body['ack'])) {
            params.push(/^(true|1)$/i.test(body['ack']));
        }

        return params;
    }

    function success(ctx, result) {
        ctx.body = {
            code: 0,
            msg: '推送成功',
            body: result
        }
    }

    function error(ctx) {
        ctx.body = {
            code: -1,
            msg: '参数不完整,推送失败'
        }
    }

    app.use(route.post('/pushMsgToSingleDevice', async function (ctx) {
        let params = getParams(ctx.request.body, ['useraccount', 'msgId', 'message']);
        params ? success(ctx, await api.pushMsgToSingleDevice.apply(api, params)) : error(ctx);
    }));
    app.use(route.post('/pushBatchUniMsg', async function (ctx) {
        let params = getParams(ctx.request.body, ['useraccounts', 'msgId', 'message']);
        params ? success(ctx, await api.pushBatchUniMsg.apply(api, params)) : error(ctx);
    }));
    app.use(route.post('/pushMsgToRoom', async function (ctx) {
        let params = getParams(ctx.request.body, ['tags', 'msgId', 'message']);
        params ? success(ctx, await api.pushMsgToRoom.apply(api, params)) : error(ctx);
    }));
    app.use(route.post('/pushMsgToAll', async function (ctx) {
        let params = getParams(ctx.request.body, ['msgId', 'message']);
        params ? success(ctx, await api.pushMsgToAll.apply(api, params)) : error(ctx);
    }));
    app.use(route.post('/pushOffLineMsg', async function (ctx) {
        let params = getParams(ctx.request.body, ['useraccount', 'msglist']);
        params ? success(ctx, await api.pushOffLineMsg.apply(api, params)) : error(ctx);
    }));
    app.use(route.post('/changeRoom', async function (ctx) {
        let params = getParams(ctx.request.body, ['useraccounts']);
        if (ctx.request.body.joins || ctx.request.body.leaves) {
            //通过推送 告知scoket 分组发生改变
            api.pushBatchUniMsg.call(api, params[0], "-2", {
                joins: ctx.request.body.joins,
                leaves: ctx.request.body.leaves
            }, 'changeRoom');
        }
        success(ctx, true);
    }));

    //开发测试
    if (process.env.NODE_ENV === 'development') {
        app.use(route.get('/user/:id', async function (ctx, uid) {
            let ip = 'localhost',
                network = require('os').networkInterfaces();
            if (network.eth0 || network.en0) {
                (network.eth0 || network.en0).forEach((details) => {
                    if (details.family == 'IPv4') {
                        ip = details.address;
                    }
                });
            }
            await ctx.render('user', {
                path: ('ws://' + ip + ':' + process.env.PORT + config.io.nsp),
                uid: uid
            });
        }));
        app.use(route.get('/test', async function (ctx) {
            await ctx.render('test');
        }));
    }
}
