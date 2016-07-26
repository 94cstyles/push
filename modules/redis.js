"use strict";
import {createClient, RedisClient} from 'redis';

RedisClient.prototype.getSync = function (key) {
    return new Promise((resolve)=> {
        this.get(key, function (err, reply) {
            if (err) console.error(err);
            resolve(err ? null : reply);
        });
    });
};


RedisClient.prototype.keysSync = function (keys) {
    return new Promise((resolve)=> {
        this.keys(keys, function (err, replies) {
            if (err) console.error(err);
            resolve(err ? null : replies);
        });
    });
};

RedisClient.prototype.existsSync = function (key) {
    return new Promise((resolve)=> {
        this.exists(key, function (err, val) {
            if (err) console.error(err);
            resolve(err ? false : !!val);
        });
    });
};

export default createClient;
