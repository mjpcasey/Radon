/**
 * @file 数据变更日志存储模型 
 */
var Schema = require('../../lib/Schema.js');

var ModelChangeLog = new Schema({
	modelId: Object,
	model: String,
	operation: Number,
	old:  Object,
	last: Object,
	TS: Date,
	extra: Object
});

module.exports = ModelChangeLog;
