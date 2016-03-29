"use strict";

const koa = require('koa');
const bodyParser = require('koa-bodyparser');
const render = require('koa-ejs');
const app = koa();
const config = require('./config.json');

//设置参数
process.env.PORT = config.io.port + parseInt(process.env.NODE_APP_INSTANCE || 0);
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.NODE_ENV = 'development';

//中间件
app.use(bodyParser());
render(app, {
    root: require('path').join(__dirname, 'views'),
    layout: false,
    viewExt: 'ejs',
    cache: process.env.NODE_ENV !== 'development'
});

//路由
require('./routes')(app);

//错误处理
app.on('error', function(err) {
    log.error('server error', err);
});

process.on("uncaughtException", function(error) {
    if (error.toString() !== 'Error: IPC channel is already disconnected') {
        process.stderr.write(error.stack);
        process.exit(1);
    }
});

//创建http服务
const server = require('http').createServer(app.callback());
server.listen(process.env.PORT);

//创建socket.io服务
require('./modules/push.js').create(server);

//内存泄露检测
if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'dev') {
    var memwatch = require('memwatch-next'),
        heapdump = require('heapdump');
    memwatch.on('leak', function(info) {
        var file = require('path').resolve('./heapdump/' + process.pid + '-' + Date.now() + '.heapsnapshot');
        heapdump.writeSnapshot(file, function(err) {
            if (err) console.error(err);
            else console.error('Wrote snapshot: ' + file);
        });
    });
}
