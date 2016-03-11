# 消息推送服务
`koa` + `socket.io` + `redis` + `pm2`

配置: 1台2核4G (redis) 服务器，2台4核12G (程序) 服务器。

测试: 保持128k同时在线，每5s高并发消息广播，无掉线无错误。

问题: socket单个连接大约50k左右，目前没有找到优化方案。

目前128k满足我们的需求，128k不是极限值，更多连接将消耗更多内存。目前24G内存在高并发情况下，内存消耗在15G左右，因为v8内存回收的惰性以及其他的考虑，内存定为每台12G。进行测试时使用了8台服务器36进程来进行压力测试，不知道因为什么，当客户端创建超过17k连接后就会出现瓶颈，不断的断线重连。[知乎神文](http://www.zhihu.com/question/20831000) 上面所说让我无比汗颜，我这配置只能跑128k，为什么？因为**有钱任性**。

## 开发笔记
nodejs最大的特点就是**单进程**、**无阻塞运行**、**异步事件驱动**。但是在实际开发过程中，并发请求处理是一个瓶颈，那就需要利用多核CPU。[官方文档](http://socket.io/docs/using-multiple-nodes/) 中有一方案使用 [cluster](https://nodejs.org/dist/latest-v5.x/docs/api/cluster.html) 和 [sticky-session](https://github.com/indutny/sticky-session) 来进行处理，但是在测试过程中，高并发连接会出现大量`503`错误，以及一直断线重连，问题是由 `sticky-session` 引起的。后改用 `pm2` + `f5(硬负载)` 进行处理。

用户数据是由`redis`进行存储处理，这2篇文章值得参考。[redis高可用架构 ](http://navyaijm.blog.51cto.com/4647068/1745569)，[redis不适合数据量高于10M条](http://blog.csdn.net/yumengkk/article/details/7902103)。

服务器使用系统为 **linux**，使用 `ulimit -n` 命令可以看到单个进程能够打开的最大文件句柄数量(socket连接也算在里面)，系统默认值1024，[修改](http://wenku.baidu.com/view/e659b4d333d4b14e852468d7.html)句柄数。

如何找到**socket对象**？

```javascript
// 单进程
io.sockets[socketID]

// 多进程
// 每个进程间的内存信息是不共享，所以我使用 redis 的订阅模式来找到socket对象
// 使用socket.io-redis 和 socket.io-emiter
// 把要进行的操作写入message中 通过socket.io-emiter推送出去
ioEmitter.in(socketID).emit('findSocket', message);

// redis 监听消息
ioRedis.subClient.on('message', (channel, msg) => {
    var args = msgpack.decode(msg);
    var packet, rooms, except;

    // ignore same uid
    if (this.ioRedis.uid == args.shift()) return;

    packet = args[0];
    rooms = args[1].rooms || [];
    except = args[1].except || [];

    if (packet && packet.nsp === undefined) {
        packet.nsp = '/';
    }

    // ignore different namespace
    if (!packet) return;

    // 在这里对消息包进行分析
    if (packet.data[0] === 'findSocket'){
        // 能走到这里说明socket对象在这个进程中
        // 查看源码 modules/push.js --> transformMesssage
    }
});
```

如何知道消息是否发送并**接收成功**？

```javascript
// 单进程
// 服务端
socket.emit('message', message, function() {
    console.log('消息发送成功');
});
// 客户端
socket.on('message', function(message, next) {
    next();
});

// 多进程
// 同样因为进程间内存信息不共享问题
// 阅读源码后发现socket发送消息都会执行 socket.packet()
// 所以我对 socket.packet 进行修改，篡改消息包，为其追加ack
// https://github.com/socketio/socket.io-protocol
// https://github.com/socketio/socket.io-parser
socket.packet = function(packet, opts) {
    if (this.client.conn.readyState == 'open') {
        opts = opts || {};
        opts.compress = false !== opts.compress;

        if (opts.preEncoded) {
            // 使用socket.io-emitter 发送的消息是被socket.io-parser编码过的
            // 创建ack
            let key = socket.nsp.ids;
            socket.nsp.ids++;
            socket.acks[key] = function() {
                console.log('消息发送成功');
            };
            // 把ack追加进packet有2种方案
            // 1.解析字符串 把key插入字符串中
            // 2.使用parser解码 转换为object 设置id属性值为key
            // 查看源码 modules/push.js --> transformSocket
        } else {
            // 使用socket.emit 发送的消息就到了这里
            // 可以使用单进程的操作 或者 上面的方法2
            if (!util.isArray(packet)) packet.nsp = this.nsp.name;
            this.client.packet(packet, opts);
        }
    }
}
```

## 压力测试
我使用 `socket.io-client` 写了一个测试用例

启动redis: `redis-server`

启动程序: `pm2 start pm2.json`

启动客户端:  `node ./bin/client -p ws://localhost:1994 -r localhost`

启动消息发送: `node ./bin/message -p http://localhost:1994/pushMsgToAll`

**client** 和 **message** 具体命令可以使用 -h 查询帮助

在`development`环境下，可以使用[自定义客户端](http://localhost:1994/user/wenchao) 和 [消息发送](http://localhost:1994/test)
