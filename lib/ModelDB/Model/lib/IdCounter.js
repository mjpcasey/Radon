/*id计数器数据模型*/
var Schema = require('../../lib/Schema.js');

var IdCounter = new Schema({
	_id: String,
	id: Number,
	lid: 'Long'
});

module.exports = IdCounter;