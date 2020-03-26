/*!
 * Module requirements.
 */

var SchemaType = require('../SchemaType');
var Int64 = require('mongodb').Long;

/**
 * Number SchemaType constructor.
 *
 * @param {String} key
 * @param {Object} options
 * @inherits SchemaType
 * @api private
 */

function Long (key, options) {
	SchemaType.call(this, key, options, 'Long');
};

function _createIncFunc(key, suffix){
	var idName = typeof key === 'string' ? key : ''; 
	var suf = suffix;
	return function() {
		var Model = this.getDB();
		var IdCounter = Model.model('lib/IdCounter');
		var _id = idName || this.getModelName() + suf;
		return IdCounter.findAndModify(
			{"_id": _id},
			[],
			{"$inc": {"lid": create(1)}},
			{"new":true}
		).then(
			function(counter)
			{
				if ( !counter ){
					counter = new IdCounter({
						_id: _id,
						lid: create(1)
					});
					return counter.save().then(
						function(counter)
						{
							return create(counter.lid);
						}
					);
				}
				return create(counter.lid);
			}
		)
	}
}

Long.prototype.increment = function (value, message) {
	if(!!value){
		this.defaultSaveValue = _createIncFunc(value, 'Id');
	}
};

function create(val)
{
	if ( val instanceof Int64 ) {
		return val;
	}
	if ( 'number' === typeof val )
	{
		return Int64.fromNumber(val);
	}
	return Int64.fromString(val, 16);
}

Long.prototype.formatFun = create;

Long.prototype.castForQuery = create;

/*!
 * Inherits from SchemaType.
 */

Long.prototype.__proto__ = SchemaType.prototype;

module.exports = Long;
