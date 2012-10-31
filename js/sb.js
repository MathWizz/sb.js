var sb = {
	extend: function (base, ex) {
		for (var key in ex) {
			if (ex.hasOwnProperty(key)) {
				base[key] = ex[key];
			}
		}
	}
};

sb.Project = function (path) {
	this._path = path;
	this.stage = null;
	this.info = null;
};

sb.extend(sb.Project.prototype, {
	open: function () {
		var self = this;
		var xhr = new XMLHttpRequest();
		xhr.open('GET', this._path, true);
		xhr.responseType = 'arraybuffer';
		xhr.onload = function () {
			var stream = new sb.ByteStream(xhr.response);
			if (stream.utf8(8) === 'ScratchV') {
				if (Number(stream.utf8(2) > 0)) {
					console.log('< 2.0');
					self.read1(stream);
				}
			}
		};
		xhr.send();
	},
	read1: function (stream) {
		console.log('Info: ' + stream.uint32());
		var ostream = new sb.ObjectStream(stream);
		console.time('read');
		console.log(this.info = ostream.readObject());
		console.timeEnd('read');
		console.time('read');
		console.log(window.stage = this.stage = ostream.readObject());
		console.timeEnd('read');
	}
});

sb.ByteStream = function (arraybuffer) {
	this.buffer = arraybuffer;
	this._index = 0;
	this._uint8array = new Uint8Array(this.buffer);
};

sb.extend(sb.ByteStream.prototype, {
	set: function (index) {
		this._index = index;
	},
	skip: function (i) {
		this._index += i;
	},
	utf8: function (length) {
		var string = '';
		for (var i = 0; i < length; i++) {
			string += String.fromCharCode(this.uint8());
		}
		return string;
	},
	arrayBuffer: function (length, reverse) {
		var array = new Uint8Array(length);
		if (reverse) {
			var i = length;
			while (i--) {
				array[i] = this.uint8();
			}
		} else {
			for (var i = 0; i < length; i++) {
				array[i] = this.uint8();
			}
		}
		return array.buffer;
	},
	uint8: function () {
		if (this.index >= this._uint8array.length) {
			throw new Error('End of stream: ' + this.index);
		}
		return this._uint8array[this._index++];
	},
	int8: function () {
		var i = this.uint8();
		return i > 63 ? i - 0xff : i;
	},
	uint16: function () {
		return this.uint8() << 8 | this.uint8();
	},
	int16: function () {
		var i = this.uint16();
		return i > 32767 ? i - 0xffff : i;
	},
	uint24: function () {
		return this.uint8() << 16 | this.uint8() << 8 | this.uint8();
	},
	uint32: function () {
		return this.uint8() * 16777216 + (this.uint8() << 16) + (this.uint8() << 8) + this.uint8();
	},
	int32: function () {
		var i = this.uint32();
		return i > 2147483647 ? i - 0xffffffff : i;
	},
	float64: function () {
		return new Float64Array(this.arrayBuffer(8, true))[0];
	}
});

sb.ObjectStream = function (stream) {
	this._stream = stream;
};

sb.extend(sb.ObjectStream.prototype, {
	readObject: function () {
		if (this._stream.utf8(10) !== 'ObjS\x01Stch\x01') {
			throw new Error('Not an object');
		}
		var size = this._stream.uint32();
		
		var table = [];
		
		var i = size;
		while (i--) {
			table.push(this.readTableObject());
		}
		
		i = size;
		while (i--) {
			this.fixObjectRefs(table, table[i]);
		}
		
		this.buildMedia(table);
		
		return this.deRef(table, table[0]);
	},
	readTableObject: function () {
		var id = this._stream.uint8();
		if (id < 99) {
			return {
				id: id,
				object: this.readFixedFormat(id)
			};
		}
		return this.readUserFormat(id);
	},
	readUserFormat: function (id) {
		var object = {
			id: id,
			version: this._stream.uint8(),
			fields: []
		};
		var i = this._stream.uint8();
		while (i--) {
			object.fields.push(this.readInline());
		}
		return object;
	},
	readFixedFormat: function (id) {
		switch (id) {
		case 9: // String
		case 10: // Symbol
		case 14: // Utf8
			return this._stream.utf8(this._stream.uint32());
		case 11: // ByteArray
			return new Uint8Array(this._stream.arrayBuffer(this._stream.uint32()));
		case 12: // SoundBuffer
			return new Uint16Array(this._stream.arrayBuffer(this._stream.uint32() * 2));
		case 13: // Bitmap
			return new Uint32Array(this._stream.arrayBuffer(this._stream.uint32() * 4));
		case 20: // Array
		case 21: // OrderedCollection
			var array = [];
			var i = this._stream.uint32();
			while (i--) {
				array.push(this.readInline());
			}
			return array;
		case 24: // Dictionary
		case 25: // IdentityDictionary
			var array = {};
			var i = this._stream.uint32();
			while (i--) {
				array[i] = [this.readInline(), this.readInline()];
			}
			return array;
		case 30: // Color
			var color = this._stream.uint32();
			return {
				r: color >> 22 & 0xff,
				g: color >> 12 & 0xff,
				b: color >> 2 & 0xff,
				a: 255
			};
		case 31: // TranslucentColor
			var color = this._stream.uint32();
			return {
				r: color >> 22 & 0xff,
				g: color >> 12 & 0xff,
				b: color >> 2 & 0xff,
				a: this._stream.uint8()
			};
		case 32: // Point
			return {
				x: this.readInline(),
				y: this.readInline()
			};
		case 33: // Rectangle
			return {
				ox: this.readInline(),
				oy: this.readInline(),
				cx: this.readInline(),
				cy: this.readInline()
			};
		case 34: // Form
			return {
				width: this.readInline(),
				height: this.readInline(),
				depth: this.readInline(),
				offset: this.readInline(),
				bitmap: this.readInline()
			};
		case 35: // ColorForm
			return {
				width: this.readInline(),
				height: this.readInline(),
				depth: this.readInline(),
				offset: this.readInline(),
				bitmap: this.readInline(),
				colors: this.readInline()
			};
		}
		throw new Error('Unknown fixed format class ' + id);
	},
	readInline: function () {
		var id = this._stream.uint8();
		switch (id) {
		case 1: // nil
			return null;
		case 2: // True
			return true;
		case 3: // False
			return false;
		case 4: // SmallInteger
			return this._stream.int32();
		case 5: // SmallInteger16
			return this._stream.int16();
		case 6: //LargePositiveInteger
		case 7: //LargeNegativeInteger
			var d1 = 0;
			var d2 = 1;
			var i = this._stream.uint16();
			while (i--) {
				var k = this._stream.uint8();
				d1 += d2 * k;
				d2 *= 256;
			}
			return id == 7 ? -d1 : d1;
		case 8: // Float
			return this._stream.float64();
		case 99:
			return {
				isRef: true,
				index: this._stream.uint24()
			};
		}
		throw new Error('Unknown inline class ' + id);
	},
	fixObjectRefs: function (table, object) {
		var id = object.id;
		if (id < 99) {
			this.fixFixedFormat(table, object);
			return;
		}
		var fields = object.fields;
		var i = fields.length;
		while (i--) {
			fields[i] = this.deRef(table, fields[i]);
		}
	},
	fixFixedFormat: function (table, object) {
		var id = object.id;
		switch (id) {
		case 20:
		case 21:
			var fields = object.object;
			var i = fields.length
			while (i--) {
				fields[i] = this.deRef(table, fields[i]);
			}
			break;
		case 24:
		case 25:
			var fields = object.object;
			var i = 0;
			while (fields[i]) {
				fields[this.deRef(table, fields[i][0])] = this.deRef(table, fields[i][1]);
				delete fields[i];
				i++;
			}
			break;
		case 35:
			object.object.colors = this.deRef(table, object.object.colors);
		case 34:
			object.object.bitmap = this.deRef(table, object.object.bitmap);
			break;
		}
	},
	deRef: function (table, object) {
		if (object && object.isRef) {
			var obj = table[object.index - 1];
			return obj.object || obj;
		}
		return object && object.object || object;
	},
	buildMedia: function (table) {
		var i = table.length;
		while (i--) {
			var id = table[i].id;
			if (id === 34 || id === 35) {
				table[i].object.canvas = this.buildImage(table[i].object);
			}
		}
	},
	buildImage: function (image) {
		var bitmap = image.bitmap;
		if (bitmap instanceof Uint8Array) {
			var stream = new sb.ByteStream(bitmap.buffer);
			var nInt = function () {
				var i = stream.uint8();
				if (i <= 223) {
					return i;
				} else if (i <= 254) {
					return (i - 224) * 256 + stream.uint8();
				}
				return stream.uint32();
			}
			var length = nInt();
			var decoded = new Uint32Array(length);
			
			var j, k, l, m, n, i = 0;
			
			while (i < length) {
				k = nInt();
				l = k >> 2;
				switch(k & 3) {
				case 0:
					i++;
					break;
				case 1:
					n = stream.uint8();
					m = n * 16777216 + (n << 16) + (n << 8) + n;
					while (l--) {
						decoded[i++] = m;
					}
					break;
				case 2:
					m = stream.uint32();
					while (l--) {
						decoded[i++] = m;
					}
					break;
				case 3:
					while (l--) {
						decoded[i++] = stream.uint32();
					}
					break;
				}
			}
			
			bitmap = decoded;
		}
		
		var canvas = document.createElement('canvas');
		canvas.width = image.width;
		canvas.height = image.height;
		var ctx = canvas.getContext('2d');
		
		var data = ctx.createImageData(image.width, image.height);
		var array = data.data;
		
		if (image.depth <= 8) {
			var colors = image.colors || this.squeakColors;
			var l = bitmap.length / image.height;
			var i1 = (1 << image.depth) - 1;
			var j1 = 32 / image.depth;
			for(var y = 0; y < image.height; y++) {
				for(var x = 0; x < image.width; x++) {
					var i2 = bitmap[y * l + Math.floor(x / j1)];
					var j2 = image.depth * (j1 - x % j1 - 1);
					var pi = (y * image.width + x) * 4;
					var ci = i2 / (1 << j2) & i1;
					var c = colors[ci];
					if (c) {
						array[pi] = c.r;
						array[pi + 1] = c.g;
						array[pi + 2] = c.b;
						array[pi + 3] = c.a === 0 ? 0 : 0xff;
					}
				}
			}
		} else if (image.depth === 16) {
			bitmap = new Uint16Array(bitmap.buffer)
			var hw = Math.round(image.width / 2);
			var i, j, k = 0, l = 0;
			for (var l = 0; l < array.length; l++) {
				if (l % image.width === 0) {
					l++;
				}
				j = bitmap[l];
				array[k++] = (j >> 10 & 0x1f) << 3;
				array[k++] = (j >> 5 & 0x1f) << 3;
				array[k++] = (j & 0x1f) << 3;
				array[k++] = 0xff;
			}
		} else if (image.depth === 32) {
			var c, j = 0;
			for (var i = 0; i < array.length; i++) {
				c = bitmap[i];
				array[j++] = c >> 16 & 0xff;
				array[j++] = c >> 8 & 0xff;
				array[j++] = c & 0xff;
				array[j++] = c === 0 ? 0 : 0xff;
			}
		}
		
		ctx.putImageData(data, 0, 0);
		return canvas;
	}
});

(function () {
	var values = [
		0xff,0xff,0xff, 0x00,0x00,0x00,	0xff,0xff,0xff,	0x80,0x80,0x80,	0xff,0x00,0x00,	0x00,0xff,0x00,	0x00,0x00,0xff,	0x00,0xff,0xff,
		0xff,0xff,0x00,	0xff,0x00,0xff,	0x20,0x20,0x20,	0x40,0x40,0x40,	0x60,0x60,0x60,	0x9f,0x9f,0x9f,	0xbf,0xbf,0xbf,	0xdf,0xdf,0xdf,
		0x08,0x08,0x08,	0x10,0x10,0x10,	0x18,0x18,0x18,	0x28,0x28,0x28,	0x30,0x30,0x30,	0x38,0x38,0x38,	0x48,0x48,0x48,	0x50,0x50,0x50,
		0x58,0x58,0x58,	0x68,0x68,0x68,	0x70,0x70,0x70,	0x78,0x78,0x78,	0x87,0x87,0x87,	0x8f,0x8f,0x8f,	0x97,0x97,0x97,	0xa7,0xa7,0xa7,
		0xaf,0xaf,0xaf,	0xb7,0xb7,0xb7,	0xc7,0xc7,0xc7,	0xcf,0xcf,0xcf,	0xd7,0xd7,0xd7,	0xe7,0xe7,0xe7,	0xef,0xef,0xef,	0xf7,0xf7,0xf7,
		0x00,0x00,0x00,	0x00,0x33,0x00,	0x00,0x66,0x00, 0x00,0x99,0x00,	0x00,0xcc,0x00,	0x00,0xff,0x00,	0x00,0x00,0x33,	0x00,0x33,0x33,
		0x00,0x66,0x33,	0x00,0x99,0x33,	0x00,0xcc,0x33,	0x00,0xff,0x33,	0x00,0x00,0x66,	0x00,0x33,0x66,	0x00,0x66,0x66,	0x00,0x99,0x66,
		0x00,0xcc,0x66,	0x00,0xff,0x66,	0x00,0x00,0x99,	0x00,0x33,0x99,	0x00,0x66,0x99,	0x00,0x99,0x99,	0x00,0xcc,0x99,	0x00,0xff,0x99,
		0x00,0x00,0xcc, 0x00,0x33,0xcc,	0x00,0x66,0xcc,	0x00,0x99,0xcc,	0x00,0xcc,0xcc,	0x00,0xff,0xcc,	0x00,0x00,0xff,	0x00,0x33,0xff,
		0x00,0x66,0xff,	0x00,0x99,0xff,	0x00,0xcc,0xff,	0x00,0xff,0xff,	0x33,0x00,0x00,	0x33,0x33,0x00,	0x33,0x66,0x00, 0x33,0x99,0x00,
		0x33,0xcc,0x00,	0x33,0xff,0x00,	0x33,0x00,0x33,	0x33,0x33,0x33,	0x33,0x66,0x33,	0x33,0x99,0x33,	0x33,0xcc,0x33,	0x33,0xff,0x33,
		0x33,0x00,0x66,	0x33,0x33,0x66,	0x33,0x66,0x66,	0x33,0x99,0x66,	0x33,0xcc,0x66,	0x33,0xff,0x66,	0x33,0x00,0x99,	0x33,0x33,0x99,
		0x33,0x66,0x99,	0x33,0x99,0x99,	0x33,0xcc,0x99, 0x33,0xff,0x99,	0x33,0x00,0xcc,	0x33,0x33,0xcc,	0x33,0x66,0xcc,	0x33,0x99,0xcc,
		0x33,0xcc,0xcc,	0x33,0xff,0xcc,	0x33,0x00,0xff,	0x33,0x33,0xff,	0x33,0x66,0xff,	0x33,0x99,0xff,	0x33,0xcc,0xff,	0x33,0xff,0xff,
		0x66,0x00,0x00, 0x66,0x33,0x00,	0x66,0x66,0x00,	0x66,0x99,0x00,	0x66,0xcc,0x00,	0x66,0xff,0x00,	0x66,0x00,0x33,	0x66,0x33,0x33,
		0x66,0x66,0x33,	0x66,0x99,0x33,	0x66,0xcc,0x33,	0x66,0xff,0x33,	0x66,0x00,0x66,	0x66,0x33,0x66,	0x66,0x66,0x66,	0x66,0x99,0x66,
		0x66,0xcc,0x66,	0x66,0xff,0x66,	0x66,0x00,0x99,	0x66,0x33,0x99,	0x66,0x66,0x99,	0x66,0x99,0x99,	0x66,0xcc,0x99, 0x66,0xff,0x99,
		0x66,0x00,0xcc,	0x66,0x33,0xcc,	0x66,0x66,0xcc, 0x66,0x99,0xcc,	0x66,0xcc,0xcc,	0x66,0xff,0xcc,	0x66,0x00,0xff, 0x66,0x33,0xff,
		0x66,0x66,0xff,	0x66,0x99,0xff,	0x66,0xcc,0xff,	0x66,0xff,0xff,	0x99,0x00,0x00,	0x99,0x33,0x00,	0x99,0x66,0x00,	0x99,0x99,0x00,
		0x99,0xcc,0x00,	0x99,0xff,0x00,	0x99,0x00,0x33,	0x99,0x33,0x33,	0x99,0x66,0x33,	0x99,0x99,0x33,	0x99,0xcc,0x33,	0x99,0xff,0x33,
		0x99,0x00,0x66,	0x99,0x33,0x66,	0x99,0x66,0x66,	0x99,0x99,0x66,	0x99,0xcc,0x66,	0x99,0xff,0x66,	0x99,0x00,0x99,	0x99,0x33,0x99,
		0x99,0x66,0x99,	0x99,0x99,0x99,	0x99,0xcc,0x99,	0x99,0xff,0x99,	0x99,0x00,0xcc,	0x99,0x33,0xcc,	0x99,0x66,0xcc,	0x99,0x99,0xcc,
		0x99,0xcc,0xcc,	0x99,0xff,0xcc,	0x99,0x00,0xff,	0x99,0x33,0xff,	0x99,0x66,0xff,	0x99,0x99,0xff,	0x99,0xcc,0xff,	0x99,0xff,0xff,
		0xcc,0x00,0x00,	0xcc,0x33,0x00,	0xcc,0x66,0x00,	0xcc,0x99,0x00,	0xcc,0xcc,0x00,	0xcc,0xff,0x00,	0xcc,0x00,0x33,	0xcc,0x33,0x33,
		0xcc,0x66,0x33,	0xcc,0x99,0x33,	0xcc,0xcc,0x33,	0xcc,0xff,0x33,	0xcc,0x00,0x66, 0xcc,0x33,0x66,	0xcc,0x66,0x66,	0xcc,0x99,0x66,
		0xcc,0xcc,0x66,	0xcc,0xff,0x66,	0xcc,0x00,0x99,	0xcc,0x33,0x99,	0xcc,0x66,0x99,	0xcc,0x99,0x99,	0xcc,0xcc,0x99,	0xcc,0xff,0x99,
		0xcc,0x00,0xcc,	0xcc,0x33,0xcc,	0xcc,0x66,0xcc, 0xcc,0x99,0xcc,	0xcc,0xcc,0xcc,	0xcc,0xff,0xcc,	0xcc,0x00,0xff,	0xcc,0x33,0xff,
		0xcc,0x66,0xff,	0xcc,0x99,0xff,	0xcc,0xcc,0xff,	0xcc,0xff,0xff,	0xff,0x00,0x00,	0xff,0x33,0x00,	0xff,0x66,0x00,	0xff,0x99,0x00,
		0xff,0xcc,0x00,	0xff,0xff,0x00,	0xff,0x00,0x33, 0xff,0x33,0x33,	0xff,0x66,0x33,	0xff,0x99,0x33,	0xff,0xcc,0x33,	0xff,0xff,0x33,
		0xff,0x00,0x66,	0xff,0x33,0x66,	0xff,0x66,0x66,	0xff,0x99,0x66,	0xff,0xcc,0x66,	0xff,0xff,0x66,	0xff,0x00,0x99,	0xff,0x33,0x99,
		0xff,0x66,0x99,	0xff,0x99,0x99,	0xff,0xcc,0x99,	0xff,0xff,0x99,	0xff,0x00,0xcc,	0xff,0x33,0xcc,	0xff,0x66,0xcc,	0xff,0x99,0xcc,
		0xff,0xcc,0xcc,	0xff,0xff,0xcc,	0xff,0x00,0xff,	0xff,0x33,0xff,	0xff,0x66,0xff,	0xff,0x99,0xff,	0xff,0xcc,0xff
	];
	var colors = [];
	var i = 0;
	while (i < values.length) {
		colors.push({
			r: values[i++],
			g: values[i++],
			b: values[i++],
			a: 0xff
		});
	}
	sb.ObjectStream.prototype.squeakColors = colors;
}) ();

sb.Stage = function () {
	this.sprites = [];
}