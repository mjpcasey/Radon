/**
 * @file Radon Error Module
 */

/**
 * @namespace
 * 
 * RADON_ERROR_MAX  -Radon框架错误码和业务错误码的隔分点
 * RADON_ERROR_PATH -Radon框架使用的错误码文件存放路径
 * APP_ERROR_FILE 	-业务代码的错误代码文件存放路径
  */
var RADON_ERROR_MAX  = 10000;
var RADON_ERROR_PATH = '../../data/error_code.js';
var APP_ERROR_FILE   = false;
var util = require('./util.js')

var INDEX_REGX = /(?:{\$([\d\w_]+)}|%(\d+))/g;
var INDEX_ARGS = null;
function REPLACE_INDEX(m, n1, n2){
	if (n2){ n1 = n2; }
	return (INDEX_ARGS.hasOwnProperty(n1) ? INDEX_ARGS[n1] : m);
}
/* 设置app errcode 文件路径，方便查找 */
exports.setAppErrorFile = function(path){
	APP_ERROR_FILE = path;
}

/**
 * 替换err中的参数，获取err信息
 * 
 * @param {Number} code -错误码
 * @param {Array} param -替换参数
 */
exports.message = function(code, param){
	var message = null;
	try {
		var code_list = null;
		if (code < RADON_ERROR_MAX){
			code_list = require(RADON_ERROR_PATH);
		}else if (APP_ERROR_FILE) {
			code_list = require(APP_ERROR_FILE);
		}
		if (code_list && code_list[code]){
			message = code_list[code];
		}
	}catch (err){}
	// 如果有指定参数, 替换参数
	if (message && param){
		INDEX_ARGS = param;
		message = message.replace(INDEX_REGX, REPLACE_INDEX);
	}
	return message;
};

/**
 * 获取错误信息
 * 
 * @param {Number} code -错误码
 * @param {String} message -错误信息字符串
 * @param {Array} param -要替换的参数列表
 */
exports.getError = function(code, message, param) {
	if (code === 0){
		return;
	}
	if (typeof message != 'string'){
		param = message;
		message = null;
	}
	if (!message){
		message = exports.message(code);
	}

	if (message){
		INDEX_ARGS = param;
		message = message.replace(INDEX_REGX, REPLACE_INDEX);
	}else {
		message = 'Unknow Error Message';
	}

	var err = new Error(util.LANG(message));
	err.radon_error = true;
	err.code = code;
	err.data = param;
	return err;
};
/* 抛出错误信息 */
exports.throw = function(code, message, param){
	throw exports.getError(code, message, param);
};
/* 打印调用栈信息 */
exports.stack = function(name){
	console.trace(name || 'Error Stack Trace');
}