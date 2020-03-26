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

function SchemaDate (key, options) {
  SchemaType.call(this, key, options, 'Date');
};

/*!
 * Inherits from SchemaType.
 */

SchemaDate.prototype.__proto__ = SchemaType.prototype;
SchemaDate.prototype.formatFun = function (val) {
  if ( val instanceof Date ) {
  	return val;
  }
  return new Date(val);
};

/*!
 * Module exports.
 */
module.exports = SchemaDate;