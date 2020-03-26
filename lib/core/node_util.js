/**
 * @file 工具函数
 */
var UD;
var OP = Object.prototype;
var AP = Array.prototype;
var util = require('util');
var Int64 = require('mongodb').Long;
/* 判断是否object类型 */
function typeOfObject(val){
	return (val && typeof(val) === 'object');
}

/* 判断对象是否含有某属性 */
var _has = OP.hasOwnProperty;
function has(obj, key){
	if (key === UD) {return false;}
	return _has.call(obj, key);
}
/* 判断数组是否为类数组结构，而非数组结构 */
function isFakeArray(val){
	var key;
	for (key in val){
		if (key === 'length'){
			if (isNaN(+val[key])){
				return false;
			}
		}else if (val.hasOwnProperty(key) && isNaN(+key)){
			return false;
		}
	}
	return true;
}

/**
 * 防环状嵌套克隆
 * @param {Mix} value 克隆的对象值
 */
function Clone(value){
	if (value == null) {
		return value;
	}

	if ((isPlainObject(value) || Array.isArray(value)) && !(value instanceof Int64)){
		var cloneKey = '___deep_clone___';

		// 已经被克隆过, 返回新克隆对象
		if (value[cloneKey]){
			return value[cloneKey];
		}

		var objClone = value[cloneKey] = (value instanceof Array ? [] : {});
		for (var key in value){
			if(value.hasOwnProperty(key)) {
				if (key !== cloneKey){
					objClone[key] = (typeOfObject(value[key]) ? Clone(value[key]) : value[key]);
				}
			}
		}
		delete value[cloneKey];
		return objClone;
	}
	else if(value instanceof Int64) {
		return Int64.fromString(value.toString());
	}

	return value;
}

exports.clone = Clone;

/**
 * 扩展合并函数
 * @param  {Number} deep   <可选> 递归合并层数
 * @param  {Object} target 接受合并内容的目标对象
 * @param  {Object} ...    需要合并到目标对象的扩展对象(1个或多个)
 * @return {Object}        返回合并后的对象内容
 */
function Extend(){
	var args = arguments;
	var len = args.length;
	var deep = args[0];
	var target = args[1];
	var i = 2;
	if (!util.isNumber(deep)){
		target = deep;
		deep = -1;
		i = 1;
	}
	if (!target){
		target = {};
	}
	while (i<len){
		if (typeOfObject(args[i])){
			target = ExtendObject(target, args[i], deep);
		}
		i++;
	}
	return target;
}
function ExtendObject(dst, src, deep){
	if (dst === src){ return dst; }
	var i, type = (dst instanceof Array ? 0 : 1) + (src instanceof Array ? 0 : 2);
	switch (type){
		case 0:
			// 都是数组, 合并有值的, 忽略undefined的
			for (i=src.length-1; i>=0;i--){
				ExtendItem(dst, i, src[i], 0, deep);
			}
			break;
		case 1:
			// 目标是对象, 新值是数组
			dst = Clone(src);
			break;
		case 2:
			// 目标是数组, 新值是对象
			if (!isFakeArray(src)){
				dst = Clone(src);
				break;
			}
		/* falls through */
		case 3:
			// 都是对象
			if (!dst){ dst = {}; }
			for (i in src){
				if (has(src, i)){
					ExtendItem(dst, i, src[i], 1, deep);
				}
			}
			break;
	}
	return dst;
}
function ExtendItem(dst, key, value, remove, deep){
	if (value === UD){
		// undefined 时删除值
		if (remove){ delete dst[key]; }
	}else if (value && (Array.isArray(value) || isPlainObject(value)) && !(value instanceof Int64)){
		// 新值为对象
		var old = dst[key];
		if (old === value){ return; }
		if (deep !== 0 && (Array.isArray(old) || isPlainObject(old))){
			// 继续合并数组和简答对象
			dst[key] = ExtendObject(old, value, --deep);
		}else {
			// 克隆新对象赋值
			dst[key] = Clone(value);
		}
	}else {
		// 直接赋值
		dst[key] = value;
	}
}

exports.extend = Extend;
/* 判断对象是否为普通的js对象 */
function isPlainObject(val) {
	return !val || Object.prototype.toString.call(val).slice(8,-1) == 'Object';
}

exports.isPlainObject = isPlainObject;

/* 数组去重 */
function unique(arr) {
	return arr.filter(function(val, index) {
		return arr.lastIndexOf(val) === index;
	});
}

exports.unique = unique;

/* 取交集并去从 */
function intersection(one , two) {
	var ret = [];
	if(Array.isArray(one) && Array.isArray(two)) {
		var first, second;
		// 小的做第一层循环
		if(one.length > two.length) {
			first = two;
			second = one;
		}
		else {
			first = one;
			second = two;
		}

		first.forEach(function(val) {
			if(second.indexOf(val) !== -1) {
				ret.push(val);
			}
		});

		return unique(ret);
	}

	return [];
}

exports.intersection = intersection;

/*
	排除某些值
	arr 比 exclude 多的值。
 */
function difference(arr, exclude) {
	var ret = [];
	if(Array.isArray(arr)) {
		if(!Array.isArray(exclude)) {
			exclude = [exclude];
		}

		arr.forEach(function(val) {
			var index = exclude.indexOf(val);
			if(!~index) {
				ret.push(val);
			}
		});
	}

	return ret;
}

exports.difference = difference;

/* 检查val 是否是空值 , 包含空的对象,空的数据等. */
function isEmpty(val) {
	if(!val) {
		return true;
	}

	if(Array.isArray(val)) {
		return !val.length;
	}

	if(util.isObject(val)) {
		for(var prop in val) {
			if(val.hasOwnProperty(prop)) {
				return false;
			}
		}

		return true;
	}

	return false;
}

exports.isEmpty = isEmpty;

/* 获取key集合 */
function keys(val) {
	var ret = [];
	for(var prop in val) {
		if(val.hasOwnProperty(prop)) {
			ret.push(prop);
		}
	}

	return ret;
}

exports.keys = keys;
/* 获取值集合 */
function values(val) {
	var ret = [];
	for(var prop in val) {
		if(val.hasOwnProperty(prop)) {
			ret.push(val[prop]);
		}
	}

	return ret;
}

exports.values = values;