"use strict";

import http from 'http';
import path from 'path';
import co from 'co';
import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import render from 'koa-ejs';
import serve from './modules/push';
import routes from './routes';
import config from './config.json';

//设置参数
process.env.PORT = config.io.port + parseInt(process.env.NODE_APP_INSTANCE || 0);
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const app = new Koa();

//错误处理
app.use(async(ctx, next) => {
    try {
        await next();
    } catch (err) {
        ctx.status = err.status || 500;
        ctx.body = {message: err.message};
    }
});

//中间件
app.use(bodyParser());
if (process.env.NODE_ENV === 'development') {
    render(app, {
        root: path.join(__dirname, 'views'),
        layout: false,
        viewExt: 'ejs',
        cache: false
    });
    app.context.render = co.wrap(app.context.render);
}

//路由
routes(app);

//创建http服务
const server = http.createServer(app.callback());
server.listen(process.env.PORT);

//创建socket.io服务
serve.create(server);