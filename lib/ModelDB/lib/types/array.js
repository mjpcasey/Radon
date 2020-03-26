/*!
 * Module requirements.
 */

var SchemaType = require('../SchemaType');

/**
 * Date SchemaType constructor.
 *
 * @param {String} key
 * @param {Object} options
 * @inherits SchemaType
 * @api private
 */

function SchemaArray (key, cast, options) {
  SchemaType.call(this, key, options, 'Array');
};

/*!
 * Inherits from SchemaType.
 */

SchemaArray.prototype.__proto__ = SchemaType.prototype;
SchemaArray.prototype.formatFun = function(val) {
	if ( Array.isArray(val) ) {
		return val;
	}
	return [];
}
/*!
 * Module exports.
 */

module.exports = SchemaArray;