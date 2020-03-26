/*!
 * Module requirements.
 */

var SchemaType = require('../SchemaType');

/**
 * Number SchemaType constructor.
 *
 * @param {String} key
 * @param {Object} options
 * @inherits SchemaType
 * @api private
 */

function SchemaNumber (key, options) {
	SchemaType.call(this, key, options, 'Number');
};

function _createIncFunc(key, suffix){
	var idName = typeof key === 'string' ? key : ''; 
	var suf = suffix;
	return function() {
		var Model = this.getDB();
		var IdCounter = Model.model('lib/IdCounter');
		var _id = idName || this.getModelName() + suf;
		return IdCounter.findAndModify({'_id': _id}, {"$inc": {"id": 1}}, {"new":true}).then(function(counter){
			if ( !counter ){
				counter = new IdCounter({
					_id: _id,
					id: 1
				});
				return counter.save().then(function(counter){
					return counter.id;
				});
			}
			return counter.id;
		});
	}
}

// 自增ID，用于唯一ID
SchemaNumber.prototype.increment = function (value, message) {
	if(!!value){
		this.defaultSaveValue = _createIncFunc(value, 'Id');
	}
};

SchemaNumber.prototype.formatFun = function(val) {
	return +val || 0;
};

/*!
 * Inherits from SchemaType.
 */

SchemaNumber.prototype.__proto__ = SchemaType.prototype;

module.exports = SchemaNumber;
