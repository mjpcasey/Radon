/**
 * @file 工具函数库
 */
"use strict";

function condition(query,name,cond){
	if(cond.length){
		if(!query[name]){
			query[name]= cond;
		}
		else{
			query[name] = query[name].concat(cond);
		}
	}

	return query;
}
/**
 * 或操作
 * 
 * @param {Object} query -查询参数
 * @param {cond} cond -附加条件
 */
function conditionOr(query,cond){
	if(!query){
		query = {};
	}
	if(!cond){
		return query;
	}
	return condition(query,'$or',cond);
}

exports.OR = conditionOr;

/**
 * 与操作
 * 
 * @param {Object} query -查询参数
 * @param {cond} cond -附加条件
 */
function conditionAnd(query,cond){
	if(!query){
		query = {};
	}
	if(!cond){
		return query;
	}
	return condition(query,'$and',cond);
}

exports.AND = conditionAnd;

//最后一个参数为要包括的word
function wordFilter(){
	var i = 0
		,ret = []
		,temp = {}
		,len = arguments.length-1
		,word = arguments[len];
	for(; i < len; i++){
		temp[arguments[i]] = {$regex: word, $options: 'i'};
		ret.push(temp);
		temp = {};
	}
	return ret;
}

exports.wordFilter = wordFilter;

function getRegx(name, space, flag) {
	if(space === undefined) {
		space = ' ';
	}
	if(flag === undefined) {
		flag = 'i';
	}

	name = name.replace(/([$^|*+\-.{}()?\\\[\]])/g, '\\$1');
	var ns = name.trim().split(new RegExp('['+ space +']+', 'g'));
	return new RegExp('(' + ns.join('|') + ')', flag);
}
exports.getRegx = getRegx;


/**
 * 时间戳格式化
 * 
 * @param {String|Number} value -日期时间字符串或数字
 * @returns {Number} 秒
 */
function toTimestamp(value) {
	if (value < 1e8 && value > 1e7){
		// YYYYMMDD 格式的日期
		value = String(value);
		value = new Date(
				value.substr(0,4)+'/'+
				value.substr(4,2)+'/'+
				value.substr(6,2)
		);
	} else if (typeof(value) == 'string' && value.indexOf('-') > -1){
		//yyyy-MM-DD格式日期
		value = value.replace(/-/g,'/');
		value = new Date(value).getTime()/1000;
	}
	if (value instanceof Date){
		// Date Object
		if (+value){
			return Math.floor(+value/1000);
		}else {
			return 0;
		}
	}else if (value > 1e11){
		// JavaScript Timestamp
		return Math.floor(value / 1000);
	}
	else {
		// Unix Timestamp
		return +value || 0;
	}
}
exports.toTimestamp = toTimestamp;

/**
 * 设置统计数据开始时间日期
 * @param  Integer date 开始时间戳
 * @return Integer        返回得到的秒数
 */
function getBeginDateTimeStamp(value){
	var _timeZone = (new Date()).getTimezoneOffset()*60; //时区
	if(value !== undefined) {
		value = toTimestamp(value);
		if(value > 0) {
			value -= (value - _timeZone) % 86400;
		}
		return value;
	}
}
exports.getBeginDateTimeStamp = getBeginDateTimeStamp;
/**
 * 设置统计数据结束时间日期
 * @param  Integer date 开始时间戳
 * @return Integer        返回得到的秒数
 */
function getEndDateTimeStamp(value){
	var _timeZone = (new Date()).getTimezoneOffset()*60; //时区
	if(value !== undefined) {
		value = toTimestamp(value);
		if(value > 0) {
			value -= (value - _timeZone) % 86400;
			value += 86399;
		}
		return value;
	}
}
exports.getEndDateTimeStamp = getEndDateTimeStamp;
