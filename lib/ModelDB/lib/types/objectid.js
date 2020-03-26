/*!
 * Module dependencies.
 */
var ObjectID = require('mongodb').ObjectID;
var SchemaType = require('../SchemaType');

/**
 * ObjectId SchemaType constructor.
 *
 * @param {String} key
 * @param {Object} options
 * @inherits SchemaType
 * @api private
 */

function ObjectId (key, options) {
	SchemaType.call(this, key, options, 'ObjectID');
};

/*!
 * Inherits from SchemaType.
 */
ObjectId.prototype.__proto__ = SchemaType.prototype;

/*!
 * change query value
 */
ObjectId.prototype.castForQuery = function(id){
	var idStr = id;
	if(id instanceof ObjectID){
		idStr = id.toString();
	}
	return ObjectID.createFromHexString(idStr);
};

/*!
 * convert _id's type to Object
 */
ObjectId.convertId2Object = function(idStr) {
	return new ObjectID(idStr);
};

/*!
 * Module exports.
 */
module.exports = ObjectId;
