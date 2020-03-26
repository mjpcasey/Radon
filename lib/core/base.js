/**
 * @file 类式继承实现。包含继承（extend） 父类方法调用(Super)等函数实现
 */

"use strict";

var version = '0.1.0';
var UDF;

/**
 * 类式继承功能函数 父类方法调用
 * 
 * @param {Prototype} proto 父类原型对象
 * @param {Object} scope this
 * @param {String} func 父类原型对象方法名
 * @param {Arguments} args 调用原型对象方法传递的参数
 */
function super_call(proto, scope, func, args){
	if (func==='' || !(func in proto)) {return UDF;}
	func = proto[func];
	if (typeof(func) != 'function') {return func;}
	if ((args instanceof arguments.constructor || args instanceof Array) && args.length){
		return func.apply(scope, args);
	}else {
		return func.call(scope);
	}
}
/**
 * 修正类方法函数, 如果有 Super() 方法调用, 先套用一层修正方法的函数
 * 
 * @param {function} Super -Super方法
 * @param {function} method -类方法 方法体内有调用Super方法需要重新修正
 */
var super_regx = /\b\.Super\b/;
function fix_super(Super, method){
	if (method instanceof Function && super_regx.test(method.toString())){
		return function(){
			this.Super = Super;
			return method.apply(this, arguments);
		};
	}else {
		return method;
	}
}
/**
 * 返回一个可以调用父类方法的函数,绑定实例对象和其父类原型对象
 * 
 * @param {Object} scope -this
 * @param {Object} proto -proto 父类原型对象
 */
function bind_super(scope, proto){
	return function(func, args){
		if (!func || typeof(func) !== 'string'){
			args = func;
			func = 'CONSTRUCTOR';
		}
		return super_call(proto, scope, func, args);
	};
}

/**
 * 继承
 * 
 * @param {object|constructor} proto -继承的属性方法对象|构造函数
 * @param {object} priv -静态私有属性方法对象
 */
function Class(){}
Class.extend = function(proto, priv){
	var _parent = this.prototype;

	// 基于类实例的父类方法调用函数
	function Super(func, args){
		if (arguments.length === 0){
			return bind_super(this, _parent);
		}

		if (!func || typeof(func) !== 'string'){
			args = func;
			func = 'CONSTRUCTOR';
		}
		return super_call(_parent, this, func, args);
	}

	// 匿名的类定义函数, 自动调用 CONSTRUCTOR 方法
	function _CLASS_(){
		var ct = this.CONSTRUCTOR;
		if (ct && ct instanceof Function){
			ct.apply(this, arguments);
		}
		return this;
	}
	// 复制类定义属性
	function Parent(){}
	Parent.prototype = _parent;
	var cls = _CLASS_.prototype = new Parent();

	if(typeof(proto) == 'function'){
		proto = new proto();
	}

	if (typeof(proto) == 'object'){
		for (var n in proto){
			if (proto.hasOwnProperty(n)){
				cls[n] = fix_super(Super, proto[n]);
			}
		}
	}

	cls.constructor = _CLASS_;
	_CLASS_.Parent  = super_call.bind(this, _parent);  	// 父类静态属性和方法的访问方法
	_CLASS_.Private = super_call.bind(this, priv);	   	// 私有静态属性和方法的访问方法
	_CLASS_.Self    = super_call.bind(this, cls);		// 公开静态属性和方法的访问方法
	_CLASS_.version = version;
	_CLASS_.extend  = this.extend;

	return _CLASS_;
};
exports.Class = Class;