"use strict";

const ioe = require('socket.io-emitter');
const config = require('../config.json');

var ioEmitter = ioe(config.redis, {
    key: config.io.key
});

const client = {
    /**
     * 向单个设备推送消息
     * @param  {[type]} id   uid or socket.id
     * @param  {[type]} mid  消息编号
     * @param  {[type]} msg  消息内容
     * @param  {[type]} type 消息事件名 默认:message
     */
    pushMsgToSingleDevice: function(id, mid, msg, type) {
        ioEmitter.of(config.io.nsp).in(id).emit(type || 'message', mid, msg);
    },
    /**
     * 推送消息给批量设备（批量单播）
     * @param  {[type]} uids 用户编号集合
     * @param  {[type]} mid  消息编号
     * @param  {[type]} msg  消息内容
     * @param  {[type]} type 消息事件名 默认:message
     */
    pushBatchUniMsg: function(uids, mid, msg, type) {
        uids.split(config.separator).forEach((uid) => {
            if (uid) this.pushMsgToSingleDevice(uid, mid, msg, type);
        });
    },
    /**
     * 向房间中的用户推送消息,即普通组播(可批量房间推送)
     * @param  {[type]} rids 房间编号集合
     * @param  {[type]} mid  消息编号
     * @param  {[type]} msg  消息内容
     * @param  {[type]} type 消息事件名 默认:message
     */
    pushMsgToRoom: function(rids, mid, msg, type) {
        rids.split(config.separator).forEach((rid) => {
            if (rid) ioEmitter.of(config.io.nsp).in(rid).emit(type || 'message', mid, msg);
        });
    },
    /**
     * 推送消息给所有设备,即广播推送,不包含消息确认
     * @param  {[type]} mid  消息编号
     * @param  {[type]} msg  消息内容
     * @param  {[type]} type 消息事件名 默认:message
     */
    pushMsgToAll: function(mid, msg, type) {
        ioEmitter.of(config.io.nsp).emit(type || 'message', mid, msg);
    }
};

module.exports = client;
