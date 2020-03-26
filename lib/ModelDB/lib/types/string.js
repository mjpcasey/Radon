/*!
 * Module requirements.
 */

var SchemaType = require('../SchemaType');

/**
 * String SchemaType constructor.
 *
 * @param {String} key
 * @param {Object} options
 * @inherits SchemaType
 * @api private
 */

function SchemaString (key, options) {
  SchemaType.call(this, key, options, 'String');
};

/*!
 * Inherits from SchemaType.
 */

SchemaString.prototype.__proto__ = SchemaType.prototype;
SchemaString.prototype.formatFun = function(val) {
	if(!val && val != 0) {
		return '';
	}

	return String(val);
};

module.exports = SchemaString;
