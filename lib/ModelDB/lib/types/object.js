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

function SchemaObject (key, options) {
  SchemaType.call(this, key, options, 'Object');
};

/*!
 * Inherits from SchemaType.
 */

SchemaObject.prototype.__proto__ = SchemaType.prototype;

/*!
 * Module exports.
 */

module.exports = SchemaObject;