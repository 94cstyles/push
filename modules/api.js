"use strict";

import util from 'util';
import ioe from 'socket.io-emitter';
import redis from './redis';
import config from '../config.json';

const ioEmitter = ioe(config.redis, {
    key: config.io.key
});
const redisClient = redis(config.redis);

export default {
    /**
     * 验证消息是否发生成功
     * @param mid 消息id
     * @returns {Promise} 成功接收到消息的 用户ids
     * @private
     */
    _checkMsgAck: function (mid) {
        return new Promise((resolve)=> {
            setTimeout(()=> {
                const key = util.format('msg@%s@', mid);
                redisClient.keys(util.format('%s*', key), function (err, replies) {
                    if (err) console.error(err);
                    if (replies.length > 0) {
                        redisClient.del(replies); //删除数据
                        resolve(replies.map(function (val) {
                            return val.replace(key, '');
                        }));
                    } else {
                        resolve([]);
                    }
                });
            }, config.delay);
        });
    },
    /**
     * 验证离线消息是否发送成功
     * @param uid 用户id
     * @param midList 消息ids
     * @returns {Promise} 成功接收到消息的 消息ids
     * @private
     */
    _checkOffLineMsg: function (uid, midList) {
        return new Promise((resolve)=> {
            setTimeout(async()=> {
                let mid, index, key;
                for ([index, mid] of midList.entries()) {
                    key = util.format('msg@%s@%s', mid, uid);
                    if (await redisClient.exists(key) === 1) {
                        redisClient.del(key); //删除记录
                    } else {
                        midList.splice(index, 1); //没有查询到记录 标记为未成功接收到消息
                    }
                }
                resolve(midList);
            }, config.delay);
        });
    },
    /**
     * 发送离线消息
     * @param uid 用户id
     * @param msgList 消息list
     * @returns {*|Promise}
     */
    pushOffLineMsg: function (uid, msgList) {
        let midList = [];
        JSON.parse(msgList).forEach(function (obj) {
            midList.push(obj.msgId);
            ioEmitter.of(config.io.nsp).in(uid).emit('true', obj.msgId, JSON.stringify(obj.message));
        });
        return this._checkOffLineMsg(uid, midList);
    },
    /**
     * 向单个设备推送消息
     * @param uid or socket.id
     * @param mid 消息编号
     * @param msg 消息内容
     * @param ack 是否回调确认
     * @returns {*}
     */
    pushMsgToSingleDevice: function (uid, mid, msg, ack = true) {
        ioEmitter.of(config.io.nsp).in(uid).emit(ack.toString(), mid, msg);
        return /^true$/.test(ack) ? this._checkMsgAck(mid) : true;
    },
    /**
     * 推送消息给批量设备（批量单播）
     * @param uids 用户编号集合
     * @param mid 消息编号
     * @param msg 消息内容
     * @param ack 是否回调确认
     * @returns {*}
     */
    pushBatchUniMsg: function (uids, mid, msg, ack = true) {
        uids.split(config.separator).forEach((uid) => {
            if (uid) ioEmitter.of(config.io.nsp).in(uid).emit(ack.toString(), mid, msg);
        });
        return /^true$/.test(ack) ? this._checkMsgAck(mid) : true;
    },
    /**
     * 向房间中的用户推送消息,即普通组播(可批量房间推送)
     * @param rooms 房间编号集合
     * @param mid 消息编号
     * @param msg 消息内容
     * @param ack 是否回调确认
     * @returns {*}
     */
    pushMsgToRoom: function (rooms, mid, msg, ack = true) {
        rooms.split(config.separator).forEach((room) => {
            if (room) ioEmitter.of(config.io.nsp).in(room).emit(ack.toString(), mid, msg);
        });
        return /^true$/.test(ack) ? this._checkMsgAck(mid) : true;
    },
    /**
     * 推送消息给所有设备,即广播推送,不包含消息确认
     * @param mid 消息编号
     * @param msg 消息内容
     * @param ack 是否回调确认
     * @returns {*}
     */
    pushMsgToAll: function (mid, msg, ack = true) {
        ioEmitter.of(config.io.nsp).emit(ack.toString(), mid, msg);
        return /^true$/.test(ack) ? this._checkMsgAck(mid) : true;
    }
}