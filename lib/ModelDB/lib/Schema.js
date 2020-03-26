/**
 * @file ModelDB Schema 类
 * ---------------------
 * 模型的设计类，主要用于
 * 1、定义数据结构
 * 2、定义模型静态方法
 * 3、定义模型实例方法
 */

 'use strict';
var Types = require('./types/index');
/* @namespace _plugins 插件缓存 */
var _plugins = {};
function Schema(obj, parent) {
	var self = this;
	self.$obj = {};			//缓存结构初始化信息
	self.$fields = {};		//字段路径，根据obj配置生成
	self.$parent = parent;	//父schema
	self.$pk;

	self.$callQueue = [];	//钩子函数，pre post加入
	self.$methods = {};
	self.$statics = {};

	self.$fieldFunsOnCreate = [];	//创建对象时的字段处理函数, e.g default
	self.$fieldFunsOnSave = [];		//保存对象时的字段处理函数, e.g id自增

	self.init(obj);			//初始化
	self.add(self.$obj);	//构建schema
}

/**
 * @public
 * 前置钩子
 * 
 * @param {String} methodName -方法名
 * @param {function} func -方法函数
 */
Schema.prototype.pre = function(methodName, func){
	this.$callQueue.push(['pre', [methodName, func]]);
  	return this;
};
/**
 * @public
 * 后置钩子
 * 
 * @param {String} methodName -方法名
 * @param {function} func -方法函数
 */
Schema.prototype.post = function(methodName, func){
	this.$callQueue.push(['post', [methodName, func]]);
	return this;
};
/**
 * 继承 包括callQueue methods statics obj
 * 
 * @param {Object} obj -数据结构缓存
 */
Schema.prototype.extend = function(obj){
	return new Schema(obj, this);
};

/* 加载插件 */
Schema.prototype.use = function(plugins){
	var i = plugins.length - 1,
		plugin,
		name,
		args;
	for ( ; i >= 0; i-- ) {
		plugin = plugins[i];
		name = plugin.name;
		args = plugin.args;
		if ( _plugins[name] ) {
			plugin = _plugins[name];
		} else {
			plugin = require('../plugins/' + name + '.js');
			_plugins[name] = plugin;
		}
		plugin(this, args);
	}
};
/**
 * 定义实例方法
 * 
 * @param {String} name -方法名
 * @param {function} fn -函数方法
 */
Schema.prototype.method = function (name, fn) {
	if ('string' != typeof name) {
		for (var i in name) {
			this.$methods[i] = name[i];
		}
	} else {
		this.$methods[name] = fn;
	}
	return this;
};
/* 定义静态方法 */
Schema.prototype.static = function(name, fn) {
	if ('string' != typeof name) {
		for (var i in name)
			this.$statics[i] = name[i];
	} else {
		this.$statics[name] = fn;
	}
	return this;
};
/* 叠加静态属性 */
Schema.prototype.staticAppend = function(name, array) {
	this.$statics[name] = this.$statics[name].concat(array);
};

/**
 * @protected
 * 初始化 schema
 */
Schema.prototype.init = function(obj) {
	//继承父类配置
	this._extend();

	//初始化自己配置
	_copy(this.$obj, obj);

	//修正配置
	if(!('_id' in this.$obj)){
		// 默认ObjectId
		this.$obj['_id'] = Types.ObjectId;
	}

	//有PK时_id使用pk相同类型
	var keys = Object.keys(this.$obj);
	var key;
	for(var i=keys.length; i-->0;){
		key = keys[i];
		if(this.$obj[key] instanceof _type && this.$obj[key].option.pk){
			this.$obj['_id'] = this.$obj[key].name;
			break;
		}
	}

};
/* 继承父类配置 */
Schema.prototype._extend = function() {
	if ( !this.$parent ) return;
	_copy(this.$obj, this.$parent.$obj);
	_copy(this.$callQueue, this.$parent.$callQueue);
	_copy(this.$statics, this.$parent.$statics);
	_copy(this.$methods, this.$parent.$methods);
};
/**
 * 缓存数据类型结构
 * 
 * @param {Object} obj -缓存结构
 * @param {String} prefix -修正路径
 */
Schema.prototype.add = function(obj, prefix) {
	prefix = prefix || '';
	var keys = Object.keys(obj)
		, key
		, i
		, name
		, option
		, nested
		, cast
		, type
		, path
		, field
		;

	for (i = 0; i < keys.length; ++i) {
		key = keys[i];
		option = null;
		nested = null;
		path = prefix + key;

		if ( Array.isArray(obj[key])) {
			name = "Array";
			if ( obj[key].length > 0 && 'Object' === obj[key][0].constructor.name  ) {
				nested = obj[key][0];
				cast = "Object"
			} else {
				type = obj[key][0] || Types.Object;
				if ( Array.isArray(type) ) {
					cast = 'Array';
				} else {
					cast = 'string' == typeof type ? type : type.name;
				}

				if ( type instanceof _type ) {
					option = type.option;
				}
			}
		} else if ( 'Object' === obj[key].constructor.name ) {
			name = "Object";
			nested = obj[key];
		} else {
			name = 'string' == typeof obj[key] ? obj[key] : obj[key].name;
		}

		// 嵌套
		if ( nested ) {
			option = option || {};
			option.isNested = true;
			var nestedKeys = Object.keys(nested);
			if ( nestedKeys.length > 0 ) {
				this.add( nested, path + '.' );
			}
		}

		// type有option
		if ( obj[key] instanceof _type ) {
			option = obj[key].option;
		}

		if ( Array.isArray(obj[key]) ) {
			this.$fields[path] = new Types["Array"](path, cast, option);
		} else {
			this.$fields[path] = new Types[name](path, option);
		}

		// 缓存默认值函数到fieldFunsOnCreate 方便调用
		field = this.$fields[path];
		if(field.isPK){
			this.$pk = path;
		}
		if ( field.defaultValue !== undefined ) {
			this.$fieldFunsOnCreate.push(_craeteDefaultFunc(field, path, this.$fields));
		}
		if ( field.defaultSaveValue !== undefined ) {
			this.$fieldFunsOnSave.push(_craeteDefaultSaveFunc(field, path, this.$fields));
		}
	}
};

// 创建对象时的字段默认值处理函数
function _craeteDefaultFunc(field, path, fields) {
	var _field = field;
	var _path = path;
	return function() {
		var self = this;
		var fieldName = _field.fieldName();
		var objs = _getParentDocsByPath(this, _path, fields); //获取path所在的全部对象
		objs.forEach(function(obj){
			if ( obj[fieldName] === undefined ) {
				var value = 'function' === typeof _field.defaultValue
					? _field.defaultValue.call(self)
					: _field.defaultValue;
				obj[fieldName] = value;
			}
		});
	}
}

// 保存对象时的字段默认值处理函数
function _craeteDefaultSaveFunc(field, path, fields) {
	var _field = field;
	var _path = path;
	return function() {
		var self = this;
		var fieldName = _field.fieldName();
		var objs = _getParentDocsByPath(this, _path, fields); //获取path所在的全部对象
		var isEmpty = objs.some(function(obj){
			return obj[fieldName] === undefined;
		});

		// 有字段需要default
		if(isEmpty){
			var value = 'function' === typeof _field.defaultSaveValue
				? _field.defaultSaveValue.call(self)
				: _field.defaultSaveValue;
			var promise = (value && typeof value.then === 'function') ? value : null;
			objs.forEach(function(obj){
				if ( obj[fieldName] === undefined ) {
					if(promise){
						promise = promise.then(function(val){
							obj[fieldName] = val;
							return val;
						});
					}else{
						obj[fieldName] = value;
					}
				}
			});
			return promise;
		}
	}
}

// 根据路径获取其所在的全部对象
function _getParentDocsByPath(obj, path, fields) {
	var result = [];
	var pieces = path.split('.');
	if ( pieces.length === 1 ) {
		result = result.concat(obj);
	} else {
		pieces.pop();
		var parentPath = pieces.join('.');
		var parentObj = _getParentDocsByPath(obj, parentPath, fields);
		var parentField = fields[parentPath];
		for ( var i = 0; i < parentObj.length; i++ ) {
			if ( parentObj[i][parentField.fieldName] ) {
				result.concat(parentObj[i][parentField.fieldName])
			}
		}
	}
	return result;
}

/**
 * @private
 * 复制源属性到目标对象
 * 
 * @param {Object|Array} to -目标
 * @param {Object|Array} from -源
 */
function _copy(to, from) {
	var keys, i, key;
	keys = Object.keys(from);
	for (i = 0; i < keys.length; ++i) {
		key = keys[i];
		to[key] = from[key];
	}
}
function _type(name, option) {
	this.name = name;
	this.option = option;
}
function Type(type, option) {
	var name = 'string' == typeof type ? type : type.name;
	return new _type(name, option);
};

Schema.Type = Type;
Schema.Types = Types;
module.exports = Schema;