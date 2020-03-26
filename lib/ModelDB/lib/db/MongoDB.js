/**
 * @file ModelDB MongoDB 类
 * ---------------------
 * MongoDB的具体操作实现
 *
 */

'use strict';
var util = require('radon').util;
var MongoClient = require('mongodb').MongoClient;
var db_option = {
    promiseLibrary: util.getPromiseClass(),
    poolSize: 20,     // 链接池
    useNewUrlParser: true,
    reconnectTries: Number.MAX_VALUE,
    connectTimeoutMS: 60e3,
    socketTimeoutMS: 60e3,
    bufferMaxEntries: 0,
};

/**
 * @class
 *
 * MongoDB 连接
 */
function MongoDB(config) {
    let uri = config.uri;
    if (uri.substr(0, 10) !== 'mongodb://') {
        uri = 'mongodb://' + uri;
    }
    this.$uri = uri;
    this.$pool_conf = config.pool;
}

/* 连接mongoDB */
MongoDB.prototype.connect = function () {
    const self = this;

    const option = Object.assign({}, db_option);
    if (self.$pool_conf && self.$pool_conf.max) {
        option.server.poolSize = self.$pool_conf.max;
    }

    return MongoClient.connect(self.$uri, option).then(function (db) {
        db.on('close', function () {
            // 响应close事件，置null用于下次connect
            self.$db = null;
        });
        return self.$db = db;
    });
};
/**
 * 连接指定的数据库
 *
 * @param {String} name -数据库名称
 */
MongoDB.prototype.collection = function (name) {
    const self = this;
    if (!self.$db) {
        return self.connect().then(function (db) {
            return new Collection(db, name);
        });
    }
    return util.promiseResolve(new Collection(self.$db, name));
};

/**
 * Mongodb ping方法
 * @returns {Promise<object>} e.g. {"ok":1}
 */
MongoDB.prototype.ping = function() {
    if (!this.$db) {
        return this.connect().then(db => this.ping());
    }
    else {
        return new Promise((res, rej) => {
            this.$db.admin().ping((err, result) => err ? rej(err) : res(result))
        });
    }
};

/**
 * @class
 *
 * @param {Object} db -mongoDB server
 * @param {name} name -数据库名称
 */
function Collection(db, name) {
    this.$name = name;
    this.$collection = db.collection(name);

    return this;
}

/**** 数据库常用操作封装 start******/
Collection.prototype.save = function (doc, options) {
    return this.$collection.save(doc, options);
};

Collection.prototype.remove = function (selector, options) {
    return this.$collection.remove(selector, options);
};

Collection.prototype.find = function (query, options) {
    var self = this;
    var cursor = self.$collection.find(query, options);
    // 排序
    if (options && options.sort) {
        cursor.sort(options.sort);
    }
    // 过滤字段
    if (options && options.projection) {
        cursor.project(options.projection);
    }
    return cursor.count().then(function (count) {
        var ret = [];
        return cursor.toArray().then(function (docs) {
            cursor.close();
            ret = ret.concat(docs);
            ret.count = count;
            return ret;
        });
    })
};

Collection.prototype.findOne = function (query, options) {
    return this.$collection.findOne(query, options);
};

Collection.prototype.findAndModify = function (query, sort, doc, options) {
    return this.$collection.findAndModify(query, sort, doc, options);
};

Collection.prototype.findOneAndUpdate = function (query, doc, options) {
    return this.$collection.findOneAndUpdate(query, doc, options);
};

Collection.prototype.update = function (selector, document, options) {
    return this.$collection.update(selector, document, options);
};

Collection.prototype.insert = function (docs, options) {
    return this.$collection.insert(docs, options);
};

Collection.prototype.insertOne = function (docs, options) {
    return this.$collection.insertOne(docs, options);
};

Collection.prototype.count = function (query, options) {
    return this.$collection.count(query, options);
};

Collection.prototype.aggregate = function (pipeline, options) {
    return this.$collection.aggregate(pipeline, options);
};

Collection.prototype.distinct = function (field, query) {
    return this.$collection.distinct(field, query);
};

/* end */
module.exports = MongoDB;


