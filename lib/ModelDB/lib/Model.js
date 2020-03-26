/**
 * @file ModelDB Model 类
 * ---------------------
 * 定义对数据库的基本操作方法API
 *
 */

'use strict';
var radon = require('radon');
var util = radon.util;
var Model = function(){};
/* 创建model对象 */
Model.compile = function(db, cfg, schema, driver) {
	/**
	 * new model 为新建一条数据
	 * model.[opration] 数据库操作
	 */
	function model(doc) {
		if (!(this instanceof model)){
			return new model(doc);
		}
		this.__doc__ = doc || {};
		this._onCreate();
	}
	model.prototype.__proto__ = Model.prototype;
	model.prototype.__ = {
		'name': cfg.name,
		'collection': cfg.collection,
		'schema': schema,
		'db': db,
		'driver': driver,
		'hooks': {}
	};

	model.prototype.getModel = function(){
		return model;
	};
	model.prototype._setSchema(schema);

	model.$modelName = cfg.name;
	model.$collection = cfg.collection;
	model.$driver = driver;
	model.$db = db;
	model.$schema = schema;
	model.__proto__ = Model;
	return model;
};
/* 设置get方法 */
function define_getter(obj, name, value){
	obj.__defineGetter__(name, function(){ return value; });
}
/* 获取Model名称 */
Model.prototype.getModelName = function() {
	return this.__.name;
};
/* 获取集合名称 */
Model.prototype.getCollectionName = function() {
	return this.__.collection;
};
/* 获取schema */
Model.prototype.getSchema = function(){
	return this.__.schema;
};
/* 获取db/MongoDB.js#MongoDB类实例 */
Model.prototype.getDriver = function(){
	return this.__.driver;
};
Model.prototype.getDB = function() {
	return this.__.db;
};

//创建时事件，目前只用于schema字段的默认值，可以扩展
Model.prototype._onCreate = function() {
	var self = this;
	self.getSchema().$fieldFunsOnCreate.forEach(function(func){
		func.call(self);
	});
};
// todo 支持mod直接指定保存方式insert or update
Model.prototype.save = function() {
	return this.saveEx();
};
Model.prototype.saveEx = function() {
	var self = this;
	var onSavePromise = self._onSave();
	var save = function(){
		var doc = self.toDocument();
		return self.getDriver().collection(self.getCollectionName()).then(function(collection){
			if(doc._id == null){
				delete self['__is_new_id__'];
				return collection.insertOne(doc).then(function(ret){
					doc._id = ret.insertedId;
					self.__doc__ = doc;
					return self;
				}).catch(function(err){
					ERROR('save: insert', err.message);
					radon.throw(2000);
				});
			}else{
				if(self['__is_new_id__']){
					delete self['__is_new_id__'];
					return collection.insertOne(doc).then(function(ret){
						self.__doc__ = doc;
						return self;
					}).catch(function(err){
						ERROR('save: insert', err.message);
						radon.throw(2000);
					});
				}else{
					var id = doc._id;
					delete doc._id;
					return collection.update(
						{"_id": id},
						{"$set": doc},
						{"upsert": true}).then(function(){
							doc._id = id;
							self.__doc__ = doc;
							return self;
						}).catch(function(err){
							ERROR('save: update', err.message);
							radon.throw(2003);
						});
				}
			}
		}).catch(createCollectionErrFun('save'));
	}

	if(onSavePromise){
		return onSavePromise.then(save);
	}else{
		return save();
	}
};

//保存时事件，目前只用于schema字段的id自增，可以扩展
Model.prototype._onSave = function() {
	var self = this;
	if(self['_id'] == null){
		self['__is_new_id__'] = true;
	}
	var funcs = self.getSchema().$fieldFunsOnSave.map(function(func){
		return func.call(self);
	});
	return util.promiseAll(funcs).then(function(){
		if(self.getSchema().$pk && self['_id'] == null){
			self['_id'] = self[self.getSchema().$pk];
		}
	});
};

Model.prototype.delete = function() {
	var self = this;
	return self.getDriver().collection(self.getCollectionName()).then(function(collection){
		return collection.remove({'_id': self._id}).then(function(ret){
			return true;
		}).catch(function(err){
			ERROR('delete: remove', err.message);
			radon.throw(2001);
		});
	}).catch(createCollectionErrFun('delete'));
};

/* 格式转化 */
Model.prototype.toDocument = function() {
	var result = {};
	var fields = this.getSchema().$fields;

	var toDoc = function(to, from, prefix) {
		var keys = Object.keys(from);
		var key, i, path, field;
		for ( i = 0; i < keys.length; i++ ) {
			key = keys[i];
			path = prefix + key;
			if ( path in fields ) {
				field = fields[path];
				if ( field.isNested() ) {
					if ( field.instance === "Array" ) {
						to[key] = [];
						if(from[key]) {
							for ( var j = 0; j < from[key].length; j++ ) {
								to[key][j] = {};
								toDoc(to[key][j], from[key][j], path + '.');
							}
						}
					} else if ( field.instance === "Object" ) {
						to[key] = {};
						if(from[key]) {
							toDoc(to[key], from[key], path + '.');
						}
					}
				} else {
					if ( '_id' != field.fieldName() && field.formatFun ) {
						to[key] = field.formatFun(from[key]);
					} else {
						to[key] = from[key];
					}
				}
			}
		}
	};

	toDoc(result, this.__doc__, '');
	return result;
};
Model.prototype.toObject = function() {
	return this.toDocument();
};
Model.prototype.toJSON = function(fields) {
	var ret = {};

	// 字段选择
	var fs = null;
	if(fields){
		if(Array.isArray(fields)) {
			if(!fields.length) {
				fields['_id'] = 1;
			} else {
				fs = fields.reduce(function(pre, field){
					pre[field] = 1;
					return pre;
				},{});
			}
		} else {
			fs = fields;
		}
	}

	//doc里的字段
	var keys = Object.keys(this.__doc__);
	for (var i = 0; i < keys.length; ++i) {
		var key = keys[i];
		if(fs && !fs[key]) continue;
		ret[key] = this[key];
	}

	//运行时附加的字段
	for ( var param in this ) {
		var past = ["__", "__doc__"];
		if(past.indexOf(param) !== -1 || typeof this[param] === 'function') continue;
		if(fs && !fs[param]) continue;
		if(this[param] && this[param].toJSON instanceof Function){
			ret[param] = this[param].toJSON();
		}else{
			ret[param] = this[param];
		}
	}

	return ret;
};

// 钩子函数 前
Model.prototype._pre = function(name, func){
	this._hook(name);
	this.__.hooks[name]['pres'].push(func);
	return this;
};
// 钩子函数 后
Model.prototype._post = function(name, func){
	this._hook(name);
	this.__.hooks[name]['posts'].push(func);
	return this;
};
// 建立钩子
Model.prototype._hook = function(name){
	var self = this;
	if(self.__.hooks[name]){
		return;
	}

	// init hook
	self.__.hooks[name] = {
		pres: [],
		posts: []
	};

	// hook method
	var fn = self[name];
	self[name] = function(){
		var self = this;
		var hook = self.__.hooks[name];
		var preIndex = 0;
		var preTotal = hook.pres.length;
		var next = function(){
			var args = Array.prototype.slice.call(arguments);
			if(preIndex < preTotal){
				args.unshift(next);
				return hook.pres[preIndex++].apply(self, args);
			}else{
				return done.apply(self, args);
			}
		};
		var done = function(){
			var args = Array.prototype.slice.call(arguments);
			var postIndex = 0;
			var postTotal = hook.posts.length;
			var post = function(val){
				if(postIndex < postTotal){
					return hook.posts[postIndex++].apply(self, [post, val]);
				}else{
					return val;
				}
			}

			// 执行原始函数
			var ret = fn.apply(self, args);
			if(ret && typeof ret.then === 'function'){
				return ret.then(function(val){
					return post.call(self, val);
				});
			}else{
				return post.call(self, ret);
			}
		}
		return next.apply(self, arguments);
	}
};
// 注册钩子
Model.prototype._registerHooks = function() {
	var q = this.getSchema().$callQueue;
	if (q) {
		for (var i = 0, l = q.length; i < l; i++) {
			this['_'+q[i][0]].apply(this, q[i][1]);
		}
	}
	return this;
};
Model.prototype._setSchema = function(schema) {
	var keys = Object.keys(schema.$fields)
		, field
		, i = keys.length
		, key
		, define = function(prototype, prop, type) {
			Object.defineProperty(prototype, prop, {
				enumerable: false
				, get: function ( ) { return this.get(prop); }
				, set: function (v) { return this.set(prop, v); }
			});
		};

	while (i--) {
		key = keys[i];
		field = schema.$fields[key];
		//只需define第一层
		if ( field.parent() ) {
			continue;
		}
		define(this, key, schema.$fields[key]);
	}

	// apply methods
	for (var i in schema.$methods){
		this[i] = schema.$methods[i];
	}

	// apply statics
	for (var i in schema.$statics){
		define_getter(this.getModel(), i, schema.$statics[i]);
	}

	//注册钩子
	this._registerHooks();
};
Model.prototype.get = function(field) {
	return this.__doc__[field];
};
Model.prototype.set = function(field, val) {
	this.__doc__[field] = val;
};
Model.prototype.delDocField = function(field) {
	delete this.__doc__[field];
}
/* 数据库基础操作 start */
Model.find = function(query, options) {
	var self = this;
	var model = self.$db.model(self.$modelName);
	var i;
	var attachMethod = function(list, methodName) {
		list[methodName] = function() {
			var res = [];
			for (var i = 0; i < list.length; i++) {
				var item = list[i];
				res.push(item[methodName].apply(item, arguments));
			}
			return res;
		}
		return list;
	}

	// 条件
	query = self.castQuery(query);

	//修正排序
	if(options && options.sort){
		for(i in options.sort){
			switch(options.sort[i]){
				case -1:
				case '-1':
				case 'desc':
				case 'descending':
					options.sort[i] = -1;
					break;
				default:
					options.sort[i] = 1;
					break;
			}
		}
	}
	return self.$driver.collection(self.$collection).then(function(collection){
		return collection.find(query, options).catch(function(err){
			ERROR('find', err.message);
			radon.throw(2009);
		});
	}).then(function(list){
		var ret = [], doc;
		for ( i = 0; i < list.length; i++ ) {
			doc = list[i];
			ret.push(new model(doc));
		}
		ret.count = list.count;
		attachMethod(ret, 'toJSON');
		attachMethod(ret, 'toDocument');
		attachMethod(ret, 'toObject');
		return ret;
	}).catch(createCollectionErrFun('find'));
};

Model.findOne = function(query, options) {
	var self = this;
	var model = self.$db.model(self.$modelName);

	query = self.castQuery(query);
	return self.$driver.collection(self.$collection).then(function(collection){
		return collection.findOne(query, options).then(function(doc){
			return doc && new model(doc);
		}).catch(function(err){
			ERROR('findOne', err.message);
			radon.throw(2009);
		});
	}).catch(createCollectionErrFun('findOne'));
};

Model.findAndModify = function(query, sort, doc, options) {
	var self = this;
	// 不传sort
	if(!Array.isArray(sort)){
		options = doc;
		doc = sort;
		sort = undefined;
	}
	var query = self.castQuery(query);
	var model = self.$db.model(self.$modelName);
	return self.$driver.collection(self.$collection).then(function(collection){
		return collection.findAndModify(query, sort, doc, options).then(function(ret){
			return ret.value && new model(ret.value) || null;
		}).catch(function(err){
			ERROR('findAndModify', err.message);
			radon.throw(2002);
		});
	}).catch(createCollectionErrFun('findAndModify'));
};

Model.findOneAndUpdate = function(query, doc, options) {
	var self = this;
	var query = self.castQuery(query);
	var model = self.$db.model(self.$modelName);
	return self.$driver.collection(self.$collection).then(function(collection){
		return collection.findOneAndUpdate(query, doc, options).then(function(ret){
			return ret.value && new model(ret.value) || null;
		}).catch(function(err){
			ERROR('findOneAndUpdate', err.message);
			radon.throw(2013);
		});
	}).catch(createCollectionErrFun('findOneAndUpdate'));
};

Model.update = function(query, document, options) {
	var self = this;
	var query = self.castQuery(query);
	return self.$driver.collection(self.$collection).then(function(collection){
		return collection.update(query, document, options).then(function(ret){
			return true;
		}).catch(function(err){
			ERROR('update', err.message);
			ERROR('info', JSON.stringify(query));
			ERROR('info', JSON.stringify(document));
			ERROR('info', JSON.stringify(collection));

			radon.throw(2003);
		});
	}).catch(createCollectionErrFun('update'));
};

Model.remove = function(query) {
	var self = this;
	var query = self.castQuery(query);
	return self.$driver.collection(self.$collection).then(function(collection){
		return collection.remove(query).catch(function(err){
			ERROR('remove', err.message);
			radon.throw(2001);
		});
	}).catch(createCollectionErrFun('remove'));
};

// 查询字段数据类型转换
Model.castQuery = function(query) {
	if ( !query ) {
		return query;
	}
	var fields = Object.keys(query),
		i = fields.length,
		sFields = this.$schema.$fields,
		field,
		type,
		val,
		result = {};

	while(i--) {
		field = fields[i];
		type = sFields[field];
		val = query[field];
		if ( type && type.castForQuery && ('_id' !== field || type.instance === 'ObjectID')) {
			result[field] = type.castForQuery(val);
		} else {
			result[field] = val;
		}
	}
	return result;
};

//聚合函数
Model.aggregate = function(pipeline, options) {
	var self = this;
	return self.$driver.collection(self.$collection).then(function(collection){
		var cursor = collection.aggregate(pipeline, options);
		return cursor.toArray().then(function(docs){
			cursor.close();
			return docs;
		}).catch(function(err){
			ERROR('aggregate', err.message);
			radon.throw(2010);
		});
	}).catch(createCollectionErrFun('aggregate'));
};

Model.count = function(query, options) {
	var self = this;
	return self.$driver.collection(self.$collection).then(function(collection){
		return collection.count(query, options).catch(function(err){
			ERROR('count', err.message);
			radon.throw(2011);
		});
	}).catch(createCollectionErrFun('count'));
};

Model.distinct = function(field,query) {
	var self = this;
	return self.$driver.collection(self.$collection).then(function(collection){
		return collection.distinct(field, query).catch(function(err){
			ERROR('count', err.message);
			radon.throw(2012);
		});
	}).catch(createCollectionErrFun('distinct'));
};

Model.ping = function() {
	return this.$driver.ping();
};
/* end */

module.exports = Model;
/* 错误处理函数 */
function createCollectionErrFun(action){
	return function(err){
		if(err.code){
			throw err;
		}
		ERROR(`Get collection failed when ${action}`, err.message);
		radon.throw(2008);
	}
}

// debug funcs
var debug = false;
function LOG(){
	if(debug){
		console.log.apply(console, arguments);
	}
}
function ERROR(title, message){
	util.log('24', `${title}: ${message}`);
}

