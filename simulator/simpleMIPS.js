/*! SimpleMIPS.js
	----------------------------------------------
	Visualize basic MIPS architecture in a browser
	- Including a mini assembler
	- 5 stage pipeline with forwarding and hazard detection
	Note: This is unfinished work
	Author: Mianzhi Wang
*/
var SimpleMIPS = (function (undefined) {
	var exports = {};
	// check support
	if (!Uint32Array || !Array.prototype.indexOf) {
		console.log('unsupported browser');
		exports.unsupported = true;
		return;
	}

	function extend(src, obj, obj2) {
		if (obj2) {
			// merge 3
			for (var key1 in obj2) {
				obj[key1] = obj2[key1];
			}
			for (var key2 in obj) {
				src[key2] = obj[key2];
			}
		} else {
			// merge 2
			for (var key in obj) {
				src[key] = obj[key];
			}
			return src;
		}
	}
	// add methods
	function methods(obj, fns) {
		if (typeof(obj) == 'function' ) {
			extend(obj.prototype, fns);
		} else {
			extend(obj, fns);
		}
	}
	// inherit
	function inherit(child, parent) {
		var cons = child.prototype.constructor;
		if (typeof(parent.constructor) == 'function') {
			child.prototype = new parent();
			child.prototype._super = parent;
			child.prototype.constructor = cons;
		} else {
			child.prototype = parent;
			child.prototype._super = parent;
			child.prototype.constructor = cons;
		}
	}
	// find overlapped elements
	function overlap(arr1, arr2) {
		var i, j,
			m = arr1.length,
			n = arr2.length,
			result = [];
		for (i = 0;i < n;i++) {
			for (j = 0;j < m;j++) {
				if (arr1[i] == arr2[j]) {
					result.push(arr1[i]);
				}
			}
		}
		return result;
	}

	function padLeft(str, chr, len) {
		var n = len - str.length;
		if (n <= 0) return str;
		for (var i = 0;i < n;i++) {
			str = chr + str;
		}
		return str;
	}

	// event bus
	var EventBus = (function () {

		function EventBus() {
			this._bus = {}
		}

		methods(EventBus, {
			// register an event handler
			register : function (ename, handler) {
				if (!this._bus[ename]) {
					this._bus[ename] = [handler];
				} else {
					this._bus[ename].push(handler);
				}
			},
			// remove an event handler
			remove : function (ename, handler) {
				var list = this._bus[ename];
				if (list) {
					list.splice(list.indexOf(handler), 1);
				}
			},
			// post an event, following arguments will be
			// passed to handlers
			post : function (ename) {
				var args = Array.prototype.slice.call(arguments, 1),
					list = this._bus[ename];
				if (list) {
					for (var i = 0, n = list.length;i < n;i++) {
						list[i].apply(null, args);
					}
				}
			}
		});

		return EventBus;
	})();
	exports.EventBus = EventBus;

	var Memory = (function () {
		var CHUNKSIZE = 65536; // in bytes
		var MASK = CHUNKSIZE-1;
		var CHUNKWIDTH = 16;
		function Memory() {
			this.chunks = [];
			// for cycle-acurrate simulation
			this.latencyCtr = 0;
			this.latency = 1;
			this.busy = false;
			this.unified = false;
		};
		

		// memory methods
		methods(Memory, {
			// alignment check should be done in CPU
			// big-endian
			// 0x11223344 -> LAddr 11 22 33 44 HAddr
			getChunk : function (addr) {
				var chunk = this.chunks[addr >>> CHUNKWIDTH];
				if (!chunk) {
					chunk = new Uint8Array(CHUNKSIZE);
					this.chunks[addr >>> CHUNKWIDTH] = chunk;
				}
				// assert busy flag here as all other operations
				// need to call this function first
				// no need to care about this during functional
				// simulation
				this.busy = true;
				return chunk;
			},
			getWord : function (addr) {
				var chunk = this.getChunk(addr);
				addr &= MASK;
				// big-endian, low address = high bits
				var tmp = (chunk[addr]   << 24) |
						  (chunk[addr+1] << 16) |
						  (chunk[addr+2] << 8) |
						  (chunk[addr+3]);
				return (tmp < 0 ? 4294967296 + tmp : tmp);
			},
			getHalfword : function (addr) {
				var chunk = this.getChunk(addr);
				addr &= MASK;
				return ((chunk[addr] << 8) |
						(chunk[addr+1]));
			},
			getByte : function (addr) {
				return (this.getChunk(addr)[(addr & MASK)]);
			},
			setWord : function (addr, val) {
				var chunk = this.getChunk(addr);
				addr &= MASK;
				chunk[addr]   = (val & 0xff000000) >>> 24;
				chunk[addr+1] = (val & 0x00ff0000) >>> 16;
				chunk[addr+2] = (val & 0x0000ff00) >>> 8;
				chunk[addr+3] = (val & 0x000000ff);
			},
			setHalfword : function (addr, val) {
				var chunk = this.getChunk(addr);
				addr &= MASK;
				val &= 0xffff;
				chunk[addr]   = (val & 0xff00) >>> 8;
				chunk[addr+1] = (val & 0x00ff);
			},
			setByte : function (addr, val) {
				this.getChunk(addr)[addr & MASK] = (val & 0xff);
			},
			// cycle-accurate simulation related methods
			// called every clock cycle
			// cpu should check busy flag before read/write
			step : function () {
				if (this.busy) {
					this.latencyCtr++;
					if (this.latencyCtr >= this.latency) {
						this.latencyCtr = 0;
						this.busy = false;
					}
				}
			},
			// debug methods
			dump : function (start, nrow, ncol) {
				var n = nrow * ncol, i, offset,
					result = '';
				for (i = 0;i < n;i++) {
					offset = start + (i << 1);
					if (i%ncol == 0) {
						result += '0x' + padLeft(offset.toString(16), '0', 8) + ' :';
					}
					result += ' ' + padLeft(this.getByte(offset).toString(16), '0', 2)
					 			  + padLeft(this.getByte(offset+1).toString(16), '0', 2);
					if (i%ncol == (ncol - 1)) {
						result += '\n';
					}
				}
				return result;
			},
			// dump to array, length in bytes
			// unpacked dump
			dumpToBuffer : function (start, length, buffer) {
				var si = start,
					ei = si + length,
					j = 0;
				for (;si < ei;si++,j++) {
					buffer[j] = this.getByte(si);
				}
			},
			importAsm : function (asmResult) {
				var i, j, n, si, ei;
				si = asmResult.dataStart;
				ei = si + asmResult.dataSize;
				for (i = si, j = 0;i < ei;i+=4,j++) {
					this.setWord(i, asmResult.dataMem[j]);
				}
				si = asmResult.textStart;
				ei = si + asmResult.textSize;
				for (i = si, j = 0;i < ei;i+=4,j++) {
					this.setWord(i, asmResult.textMem[j]);
				}
			}
		});

		return Memory;
	})();
	exports.Memory = Memory;


	var CPU = (function () {
		var exports = {};

		// instruction set
		var instructionTable = {
			// load/store
			'lb'	: ['1000 00ss ssst tttt iiii iiii iiii iiii','RC','S'], // $t=(byte)mem[$s+imm]
			'lbu'	: ['1001 00ss ssst tttt iiii iiii iiii iiii','RC','S'], // $t=(ubyte)mem[$s+imm]
			'lh'	: ['1000 01ss ssst tttt iiii iiii iiii iiii','RC','S'], // $t=(halfword)mem[$s+imm]
			'lhu'	: ['1001 01ss ssst tttt iiii iiii iiii iiii','RC','S'], // $t=(uhalfword)mem[$s+imm]
			'lui'	: ['0011 1100 000t tttt iiii iiii iiii iiii','RI','U'], // $t=imm<<16
			'lw'	: ['1000 11ss ssst tttt iiii iiii iiii iiii','RC','S'], // $t=(word)mem[$s+imm]
			'sb'	: ['1010 00ss ssst tttt iiii iiii iiii iiii','RC','S'], // (byte)mem[$s+imm]=$t
			'sh'	: ['1010 01ss ssst tttt iiii iiii iiii iiii','RC','S'], // (halfword)mem[$s+imm]=$t, must align
			'sw'	: ['1010 11ss ssst tttt iiii iiii iiii iiii','RC','S'], // (word)mem[$s+imm]=$t, must align
			// arithmetic
			'addi'	: ['0010 00ss ssst tttt iiii iiii iiii iiii','RRI','S'], // $t=$s+imm with ov
			'addiu'	: ['0010 01ss ssst tttt iiii iiii iiii iiii','RRI','U'], // $t=$s+imm unsigned no ov
			'add'	: ['0000 00ss ssst tttt dddd d000 0010 0000','RRR','N'], // $d=$s+$t with ov
			'addu'	: ['0000 00ss ssst tttt dddd d000 0010 0001','RRR','N'], // $d=$s+$t unsigned no ov
			'sub'	: ['0000 00ss ssst tttt dddd d000 0010 0010','RRR','N'], // $d=$s-$t with ov
			'subu'	: ['0000 00ss ssst tttt dddd d000 0010 0011','RRR','N'], // $d=$s-$t unsigned no ov
			'slt'	: ['0000 00ss ssst tttt dddd d000 0010 1010','RRR','N'], // $d=($s<$t)?1:0 signed
			'slti'	: ['0010 10ss ssst tttt iiii iiii iiii iiii','RRI','S'], // $t=($s<imm)?1:0 signed extend imm
			'sltu'	: ['0000 00ss ssst tttt dddd d000 0010 1011','RRR','N'], // $d=($s<$t)?1:0 unsigned
			'sltiu'	: ['0010 11ss ssst tttt iiii iiii iiii iiii','RRI','U'], // $t=($s<imm)?1:0 unsigned
			// logical
			'and'	: ['0000 00ss ssst tttt dddd d000 0010 0100','RRR','N'], // $d=$s&$t
			'andi'	: ['0011 00ss ssst tttt iiii iiii iiii iiii','RRI','U'], // $t=$s$imm zero extend
			'or'	: ['0000 00ss ssst tttt dddd d000 0010 0101','RRR','N'], // $d=$s|$t
			'ori'	: ['0011 01ss ssst tttt iiii iiii iiii iiii','RRI','U'], // $t=$s|imm zero extend
			'xor'	: ['0000 00ss ssst tttt dddd d000 0010 0110','RRR','N'], // $d=$s^$t
			'xori'	: ['0011 10ss ssst tttt iiii iiii iiii iiii','RRI','U'], // $t=$s^imm zero extend
			'nor'	: ['0000 00ss ssst tttt dddd d000 0010 0111','RRR','N'], // $d=$s nor $t
			'sll'	: ['0000 0000 000t tttt dddd daaa aa00 0000','RRA','N'], // $d=$t<<a
			'sllv'	: ['0000 00ss ssst tttt dddd d000 0000 0100','RRR','N'], // $d=$t<<($s&0x1f)
			'srl'	: ['0000 0000 000t tttt dddd daaa aa00 0010','RRA','N'], // $d=$t>>a logic
			'sra'	: ['0000 0000 000t tttt dddd daaa aa00 0011','RRA','N'], // $d=$t>>a arithmetic
			'srlv'	: ['0000 00ss ssst tttt dddd d000 0000 0110','RRR','N'], // $d=$t>>($s&0x1f) logic
			'srav'	: ['0000 00ss ssst tttt dddd d000 0000 0111','RRR','N'], // $d=$t>>($s&0x1f) arithmetic
			// multiplication
			//'mfhi'	: ['',''],
			//'mflo'	: ['',''],
			'mul'	: ['0000 00ss ssst tttt dddd d000 0001 1000','RRR','N'], // $d=$s*$t with ov
			'mulu'	: ['0000 00ss ssst tttt dddd d000 0001 1001','RRR','N'], // $d=$s*$t with ov
			'div'	: ['0000 00ss ssst tttt dddd d000 0001 1010','RRR','N'], // $d=$s*$t with ov
			'divu'	: ['0000 00ss ssst tttt dddd d000 0001 1011','RRR','N'], // $d=$s*$t with ov
			
			// jmp (HAVE DELAY SLOTS)
			'j'	: ['0000 10ii iiii iiii iiii iiii iiii iiii','I','U'], // imm<<2 specify low bits of pc
			'jal'	: ['0000 11ii iiii iiii iiii iiii iiii iiii','I','U'], // imm<<2 specify low bits of pc and ra <-- pc+4
			'jr'	: ['0000 00ss sss0 0000 0000 0000 0000 1000','R','N'], // pc=$s
			// branch (HAVE DELAY SLOTS)
			'beq'	: ['0001 00ss ssst tttt iiii iiii iiii iiii','RRI','S'], // branch when $s=$t
			'bne'	: ['0001 01ss ssst tttt iiii iiii iiii iiii','RRI','S'], // branch when $s!=$t
			'blez'	: ['0001 10ss sss0 0000 iiii iiii iiii iiii','RI','S'], // if $s<=0 pc=pc+sign_ext(imm<<2)
			'bgtz'	: ['0001 11ss sss0 0000 iiii iiii iiii iiii','RI','S'], // if $s>0 pc=pc+sign_ext(imm<<2)
			'bltz'	: ['0000 01ss sss0 0000 iiii iiii iiii iiii','RI','S'], // if $s<0 pc=pc+sign_ext(imm<<2)
			'bgez'	: ['0000 01ss sss0 0001 iiii iiii iiii iiii','RI','S'], // if $s>=0 pc=pc+sign_ext(imm<<2)
			'bltzal': ['0000 01ss sss1 0000 iiii iiii iiii iiii','RI','S'], // if $s<0 ra = pc+4 and pc=pc+sign_ext(imm<<2)
			'bgez'	: ['0000 01ss sss0 0001 iiii iiii iiii iiii','RI','S'], // if $s>=0 pc=pc+sign_ext(imm<<2)
			//'bgezal': ['',''], // 
			// misc
			'nop'	: ['0000 0000 0000 0000 0000 0000 0000 0000','N','N'], // no op
			'break' : ['0000 00cc cccc cccc cccc cccc cc00 1101','N','N'], // break
			'print' : ['1111 11ss sss0 0000 0000 0000 0000 0000','R','N'], // print $s simulation
			'printm': ['1111 11ss sss0 0000 0000 0000 0000 0001','R','N'], // print mem[$s] simulation
			'prints': ['1111 11ss sss0 0000 0000 0000 0000 0010','R','N']  // print string@$s
		};
		// classify instructions from the table
		(function () {
			var cur, needRs, needRd, needRt, needImm,
				INST_ALL = [],
				INST_CAT = {	// instruction categorized by assembly format
					RRR : [],
					RRI : [],
					RRA : [],
					//RRC : [],
					//RR  : [],
					RI  : [],
					RC  : [],
					R 	: [],
					I	: [],
					N	: []
				},
				INST_REL_PC = [],		// instructions using relative PC
				INST_IMM_SHIFT = [],	// instructions using immediate number for shifting 
				INST_UNSIGNED = [],		// instructions with unsigned imm
				INST_SIGNED = [];		// instructions with signed imm (need convertion when encoding)
			// classify
			for (var inst in instructionTable) {
				cur = instructionTable[inst];
				if (cur[0] && cur[0].length > 0) {
					INST_CAT[cur[1]].push(inst);
					INST_ALL.push(inst);
					if (inst.charAt(0) == 'b') {
						INST_REL_PC.push(inst);
					}
					if (cur[0].indexOf('a') > 0) {
						INST_IMM_SHIFT.push(inst);
					}
					if (cur[2] == 'U') {
						INST_UNSIGNED.push(inst);
					}
					if (cur[2] == 'S') {
						INST_SIGNED.push(inst);
					}
				}
			}
			// build translators
			var translators = {}, funcBody,
				instCode, funcCode,
				immStartIdx, immEndIdx, immLength, rtCode;
			for (var inst in instructionTable) {
				funcBody = '';
				cur = instructionTable[inst][0]
						.replace(/c/g,'0') // @TODO: break code support
						.replace(/a/g,'i') // a is also i
						.replace(/-/g,'0')
						.replace(/ /g,''); // no need for format
				instCode = parseInt(cur.slice(0, 6), 2);
				// NOTE: becareful with JavaScripts casting here
				// 0xffffffff > 0
				// 0xffffffff & 0xffffffff = -1
				funcBody += 'var base = ' + (instCode << 26) + ';\n';
				
				// rs, rd, rt
				if (cur.indexOf('s') > 0) {
					funcBody += 'base |= (info.rs << 21);\n';
				}
				if (cur.indexOf('d') > 0 ) {
					funcBody += 'base |= (info.rd << 11);\n';
				}
				if (cur.indexOf('t') > 0 ) {
					funcBody += 'base |= (info.rt << 16);\n';
				}
				// imm
				immStartIdx = cur.indexOf('i');
				immEndIdx = cur.lastIndexOf('i');
				immLength = immEndIdx - immStartIdx;
				if (immLength > 0) {
					if (INST_SIGNED.indexOf(inst) >= 0) {
						// convert signed immediate number to complement form
						funcBody += 'base |= (((info.imm<0)?' + (1<<(immLength+1)) + '+info.imm:info.imm) << ' + (31-immEndIdx) + ');\n';
					} else {
						funcBody += 'base |= (info.imm << ' + (31-immEndIdx) + ');\n';
					}
				}
				// function code
				if (immEndIdx < 26) {
					//console.log(cur.slice(26, 32));
					funcCode = parseInt(cur.slice(26, 32), 2);
					funcBody += 'base |= ' + (funcCode) + ';\n';
				}

				// For bltz, bgez, bltzal, bgezal
				if((immLength > 0) && (cur.indexOf('t') < 0)) {
					rtCode = parseInt(cur.slice(11, 16), 2);
					funcBody += 'base |= ' + (rtCode << 16) + ';\n';
				}

				funcBody += 'if (base < 0) base = 4294967296 + base;\n'
				funcBody += 'return base;';
				translators[inst] = new Function('info', funcBody);
			}
			exports.INST_UNSIGNED = INST_UNSIGNED;
			exports.INST_IMM_SHIFT = INST_IMM_SHIFT;
			exports.INST_REL_PC = INST_REL_PC;
			exports.INST_CAT = INST_CAT;
			exports.INST_ALL = INST_ALL;
			exports.translators = translators;
		})();

		var SIM_MODE = {
			FUNCTIONAL : 0,
			ACCURATE : 1
		};
		exports.SIM_MODE = SIM_MODE;

		var EXCEPTION_CODE = {
			INVALID_INST : 1,
			INT_OVERFLOW : 2,
			PC_ALIGN : 4,
			DATA_ALIGN : 8,
			BRANCH_IN_DELAY_SLOT : 16,
			BREAK : 32,
			PC_LIMIT : 64
		};
		var MAX_PC = 0x10000000; // limit pc range in simulator
		exports.EXCEPTION_CODE = EXCEPTION_CODE;

		var STALL_SET = {
				PC : 1,
				IF : 2,
				ID : 4,
				EX : 8,
				MA : 16,
				WB : 32
			},
			STALL_CLEAR = {
				PC : ~STALL_SET.PC,
				IF : ~STALL_SET.IF,
				ID : ~STALL_SET.ID,
				EX : ~STALL_SET.EX,
				MA : ~STALL_SET.MA,
				WB : ~STALL_SET.WB
			};
		exports.STALL_FLAGS = STALL_SET;
		/*
		 *  Current callbacks available
		 *  onPrint(src, value)
		 */
		function CPU(mem, mode, callbacks) {
			this.eventBus = new EventBus();
			this.mode = mode;
			this.mem = mem;
			this.pc = 0;
			this.cycle = 0;
			this.registerFile = new Uint32Array(32);
			this.callbacks = callbacks || {};
			if (mode == SIM_MODE.FUNCTIONAL) {
				this.step = _fStep;
				this.reset = _fReset;
			} else {
				this._initPipeline = _initPipeline;
				this.reset = _aReset;
				this.step = _aStep;
			}
			this.reset();
		}

		methods(CPU, {
			dumpRegisterFile : function (buffer) {
				if (!buffer) {
					var str = '';
					for (var i = 0;i < 32;i++) {
						str += 'r' + i + '\t: 0x' + padLeft(this.registerFile[i].toString(16), '0', 8) + '\n';
					}
					return str;
				} else {
					for (var i = 0;i < 32;i++) {
						buffer[i] = this.registerFile[i];
					}
				}
			}
		});

		function _fReset() {
			this.cycle = 0;
			this.pc = 0x00040000;
			this.branchTarget = undefined;
			this.registerFile[28] = 0x10008000; // $gp
			this.registerFile[29] = 0x7ffffffc; // $sp
		}

		function _fStep(inDelaySlot) {
			//console.log(this);
			var mem = this.mem,
				r = this.registerFile,
				inst = mem.getWord(this.pc);
			r[0] = 0; // $r0 is always 0
			// decode
			var tmp = 0,
				hasDelaySlot = false,
				nextPC = this.pc + 4,
				exception = 0,
				breaking = false,
				opcode = (inst & 0xfc000000) >>> 26,
				func = inst & 0x3f,
				rs = (inst & 0x03e00000) >>> 21, 
				rt = (inst & 0x001f0000) >>> 16,
				rd = (inst & 0x0000f800) >>> 11,
				a = (inst & 0x000007c0) >>> 6,
				imm = inst & 0xffff,
				imms = (imm & 0x8000) ? (imm | 0xffff0000) : imm; // sign-extended imm

			this.cycle++;
			switch (opcode) {
				case 0:
					switch (func) {
						case 0: // sll rd, rt, sa
							r[rd] = r[rt] << a;
							break;
						case 2: // srl rd, rt, sa
							r[rd] = r[rt] >>> a;
							break;
						case 3: // sra rd, rt, sa
							r[rd] = r[rt] >> a;
							break;
						case 4: // sllv rd, rt, rs
							r[rd] = r[rt] << (r[rs] & 0x1f);
							break;
						case 6: // srlv rd, rt, rs
							r[rd] = r[rt] >>> (r[rs] & 0x1f);
							break;
						case 7: // srav rd, rt, rs
							r[rd] = r[rt] >> (r[rs] & 0x1f);
							break;
						case 8: // jr rs
							nextPC = r[rs];
							hasDelaySlot = true; 
							break;
						case 13: // break;
							// @TODO Break
							exception |= EXCEPTION_CODE.BREAK;
							break;
						//case 16: // mfhi
						//case 17: // mthi
						//case 18: // mflo
						//case 19: // mtlo
						case 24: // mult
							tmp = (r[rs] | 0) * (r[rt] | 0);
							if (tmp > 0x7fffffff || tmp < -0x80000000) {
								exception |= EXCEPTION_CODE.INT_OVERFLOW;
							}
							r[rd] = tmp;
							break;
						case 25: // multu rd, rs, rt
							r[rd] = r[rs] * r[rt];
							break;
						case 26: // div rd, rs, rt
							tmp = (r[rs] | 0) / (r[rt] | 0);
							if (tmp > 0x7fffffff || tmp < -0x80000000) {
								exception |= EXCEPTION_CODE.INT_OVERFLOW;
							}
							r[rd] = tmp;
							break;
						case 27: // divu
							r[rd] = r[rs] / r[rt];
							break;
						case 32: // add rd, rs, rt with overflow check
							// JavaScript casting trick here
							// 0xffffffff | 0 = -1 --> get signed from unsigned
							tmp = (r[rs] | 0) + (r[rt] | 0);
							if (tmp > 0x7fffffff || tmp < -0x80000000) {
								exception |= EXCEPTION_CODE.INT_OVERFLOW;
							}
							r[rd] = tmp;
							break;
						case 33: // addu rd, rs, rt
							r[rd] = r[rs] + r[rt];
							break;
						case 34: // sub rd, rs, rt with overflow check
							tmp = (r[rs] | 0) - (r[rt] | 0);
							if (tmp > 0x7fffffff || tmp < -0x80000000) {
								exception |= EXCEPTION_CODE.INT_OVERFLOW;
							}
							r[rd] = tmp;
							break;
						case 35: // subu rd, rs, rt
							r[rd] = r[rs] - r[rt];
							break;
						case 36: // and rd, rs, rt
							r[rd] = r[rs] & r[rt];
							break;
						case 37: // or rd, rs, rt
							r[rd] = r[rs] | r[rt];
							break;
						case 38: // xor rd, rs, rt
							r[rd] = r[rs] ^ r[rt];
							break;
						case 39: // nor rd, rs, rt
							r[rd] = ~(r[rs] | r[rt]);
							break;
						case 42: // slt rd, rs, rt
							r[rd] = (r[rs] | 0) < (r[rt] | 0);
							break;
						case 43: // sltu rd, rs, rt
							r[rd] = (r[rs] < r[rt]);
							break;
						default:
							exception |= INVALID_INST;
					}
					break;
				case 1:
					switch (rt) {
						case 0: // bltz rs, offset
							if ((r[rs] | 0) < 0) {
								nextPC = this.pc + (imms << 2);
								hasDelaySlot = true;
							}
							break;
						case 16: // bltzal rs, offset
							if ((r[rs] | 0) < 0) {
								r[31] = nextPC+4; 
								nextPC = this.pc + (imms << 2);
								hasDelaySlot = true;
							}
							break;
						case 1: // bgez rs, offset
							if ((r[rs] | 0) >= 0) {
								nextPC = this.pc + (imms << 2);
								hasDelaySlot = true;
							}
							break;
						default:
							exception |= INVALID_INST;
					}
					break;
				case 2: // J imm
					tmp = this.pc;
					tmp = (tmp & 0xf0000000) | ((inst & 0x03ffffff) << 2);
					if (tmp < 0) tmp = tmp + 4294967296;
					nextPC = tmp;
					hasDelaySlot = true;
					break;
				case 3: // JAL imm
					tmp = this.pc;
					tmp = (tmp & 0xf0000000) | ((inst & 0x03ffffff) << 2);
					if (tmp < 0) tmp = tmp + 4294967296;
					this.registerFile[31] = nextPC+4;
					nextPC = tmp;
					hasDelaySlot = true;
					break;
				case 4: // beq rs, rt, offset
					if (r[rs] == r[rt]) {
						nextPC = this.pc + (imms << 2);
						hasDelaySlot = true;
					}
					break;
				case 5: // bne rs, rt, offset
					if (r[rs] != r[rt]) {
						nextPC = this.pc + (imms << 2);
						hasDelaySlot = true;
					}
					break;
				case 6: // blez rs, offset
					if (r[rs] | 0 <= 0) {
						nextPC = this.pc + (imms << 2);
						hasDelaySlot = true;
					}
					break;
				case 7: // bgtz rs, offset
					if ((r[rs] | 0) > 0) {
						nextPC = this.pc + (imms << 2);
						hasDelaySlot = true;
					}
					break;
				case 8: // addi rt, rs, imm with overflow check
					tmp = (r[rs] | 0) + imms;
					if (tmp > 0x7fffffff || tmp < -0x80000000) {
						exception |= EXCEPTION_CODE.INT_OVERFLOW;
					}
					r[rt] = tmp;
					break;
				case 9: // addiu rt, rs, imm
					if (imm & 0x8000) {
						r[rt] = r[rs] + imm + 0xffff0000;
					} else {
						r[rt] = r[rs] + imm;
					}
					break;
				case 10: // slti rt, rs, imm
					r[rt] = ((r[rs] | 0) < imms);
					break;
				case 11: // sltiu
					tmp = imm & 0x7fff;
					if (imm & 0x8000) {
						// [max_unsigned-32767, max_unsigned]
						r[rt] = (r[rs] < (tmp + 0xffff0000));
					} else {
						// [0, 32767]
						r[rt] = (r[rs] < tmp);
					}
					break;
				case 12: // andi rt, rs, imm
					r[rt] = r[rs] & imm;
					break;
				case 13: // ori rt, rs, imm
					r[rt] = r[rs] | imm;
					break;
				case 14: // xori rt, rs, imm
					r[rt] = r[rs] ^ imm;
					break;
				case 15: // lui rt, imm
					r[rt] = imm << 16;
					break;
				case 32: // lb rt, offset(rs) sign extended
					tmp = mem.getByte(r[rs] + imms);
					if (tmp < 128) {
						r[rt] = tmp;
					} else {
						r[rt] = tmp | 0xffffff00;
					}
					break;
				case 33: // lh rt, offset(rs) sign extended
					tmp = r[rs] + imms; // effective address
					if (tmp & 0x01) {
						exception |= EXCEPTION_CODE.DATA_ALIGN;
					} else {
						tmp = mem.getHalfword(tmp);
						if (tmp < 32768) {
							r[rt] = tmp;
						} else {
							r[rt] = tmp | 0xffff0000;
						}
					}
					break;
				case 35: // lw
					tmp = r[rs] + imms; // effective address
					if (tmp & 0x03) {
						exception |= EXCEPTION_CODE.DATA_ALIGN;
					} else {
						r[rt] = mem.getWord(tmp);
					}
					break;
				case 36: // lbu rt, offset(rs)
					r[rt] = mem.getByte(r[rt] + imms);
					break;
				case 37: // lhu rt, offset(rs)
					tmp = r[rs] + imms; // effective address
					if (tmp & 0x01) {
						exception |= EXCEPTION_CODE.DATA_ALIGN;
					} else {
						r[rt] = mem.getHalfword(tmp);
					}
					break;
				case 40: // sb rt, offset(rs)
					mem.setByte(r[rs] + imms, r[rt] & 0xff);
					break;
				case 41: // sh rt, offset(rs)
					tmp = r[rs] + imms;
					if (tmp & 0x01) {
						exception |= EXCEPTION_CODE.DATA_ALIGN;
					} else {
						mem.setHalfword(tmp, r[rt] & 0xffff);
					}
					break;
				case 43: // sw rt, offset(rs)
					tmp = r[rs] + imms;
					if (tmp & 0x03) {
						exception |= EXCEPTION_CODE.DATA_ALIGN;
					} else {
						mem.setWord(tmp, r[rt]);
					}
					break;
				case 63: // simulator special
					switch (func) {
						case 0: // print register
							this.eventBus.post('print', 'r' + rs, 'r', r[rs]);
							break;
						case 1: // print memory
							this.eventBus.post('print', '0x' + padLeft(r[rs].toString(16), '0', 8), 'm', mem.getByte(r[rs]))
							break;
						case 2: // print string
							tmp = r[rs];
							var str = '', curChar;
							while ((curChar = mem.getByte(tmp)) != 0) {
								str += String.fromCharCode(curChar);
								tmp++;
							}
							this.eventBus.post('print','0x' + padLeft(r[rs].toString(16), '0', 8), 's', str);
							break;
						default:
					}
					break;
				default:
					exception |= EXCEPTION_CODE.INVALID_INST;
			}
			
			// exec pending branch
			if (this.branchTarget) {
				this.pc = this.branchTarget;
				this.branchTarget = undefined;
				return exception;
			}

			if (nextPC < 0) nextPC += 0x100000000;
			if (nextPC & 0x3) {
				exception |= EXCEPTION_CODE.PC_ALIGN;
				nextPC += 4 - (nextPC & 0x3);
			}

			// exec instruction in delay slot in the next step
			// but save target PC here
			if (hasDelaySlot) {
				if (this.branchTarget) {
					exception |= EXCEPTION_CODE.BRANCH_IN_DELAY_SLOT;
				}
				this.branchTarget = nextPC;
			}


			this.pc += 4;
			if (this.pc > 0xffffffff) this.pc -= 0x100000000;
			if (this.pc > MAX_PC) {
				this.pc = MAX_PC;
				exception |= PC_LIMIT;
			}

			return exception;
		}

		// cycle-accurate simulation
		// 5-stage pipeline : IF > ID > EX > MA > WB
		// branch is calculated in ID stage
		// delay slot is needed
		// all stages have 1 cycle delay
		
		var ALU_OP = {
			ADD : 0,
			SUB : 1,
			AND : 2,
			OR  : 3,
			XOR : 4,
			NOR : 5,
			SLL : 6,
			SRL : 7,
			SRA : 8,
			SLT : 9,
			SLTU : 10,
			NOP : 11,
			MUL : 12,
			DIV : 13
		}, MEM_OP = {
			NOP : 0,
			RB  : 1,
			RHW : 2,
			RW  : 3,
			WB  : 4,
			WHW : 5,
			WW  : 6
		},BRANCH_COND = {
			N : 0,
			LTZ : 1,
			GTZ : 2,
			LTEZ : 3,
			GTEZ : 4,
			EQ : 5,
			NEQ : 6
		};
		exports.ALU_OP = ALU_OP;
		exports.MEM_OP = MEM_OP;
		exports.BRANCH_COND = BRANCH_COND;

		function _initPipeline() {
			if (!this.if_id) this.if_id = {};
			extend(this.if_id, {
				pc : 0,
				inst : 0
			});
			if (!this.id_ex) this.id_ex = {};
			extend(this.id_ex, {
				// hardware
				aluOp : ALU_OP.NOP,		// alu function select
				memOp : 0,		// memory operation 0=nop
								//					1=rByte 2=rHalfword 3=rWord
								//					4=wByte 5=wHalfword 6=wWord
				memLdSgn : false,	// memory load sign extension flag
				memSrc : 32,	// memory write source, 0~31=r0~r32, 32=imm
				memVal : 0,		// value to be written to memory
				oprA : 0,		// alu input a
				oprB : 0,		// alu input b
				oprASrc : 0,
				oprBSrc : 33,
				ovEn : false,	// set to true to enable overflow handling
				regDst : -1,		// destination register address in WB stage, -1=nop
				regSrc : 0,		// writeback value source, 0=alu, 1=mem
				sa : 0,			// shift amount
				// debug
				rs : 0,
				rt : 0,
				rd : 0,
				imm : 0,
				pc : 0,
				inst : 0
			});
			if (!this.ex_ma) this.ex_ma = {};
			extend(this.ex_ma, {
				// hardware
				aluOut : 0,		// alu output, can be memory addr
				memOp : 0,
				memLdSgn : false,
				memSrc : 32,
				memVal : 0,
				regDst : -1,
				regSrc : 0,
				// debug
				pc : 0,
				inst : 0
			});
			if (!this.ma_wb) this.ma_wb = {};
			extend(this.ma_wb, {
				// hardware
				regVal : 0,		// writeback value
				regDst : -1,
				// debug
				pc : 0,
				inst : 0
			});
			this.retiredPC = 0;
			this.retiredInst = 0;
			if (!this.debugInfo) this.debugInfo = {};
			extend(this.debugInfo, {
				stallFlag : 0,
				bCond : -1,
				bCondAVal : 0,
				bCondBVal : 0,
				bCondASrc : 0,
				bCondBSrc : 0,
				bCondAFwd : undefined,
				bCondBFwd : undefined,
				bBaseSrc : 0,
				bBaseFwd : undefined,
				bTarget : 0,
				bTaken : false,
				memWSrc : undefined,
				memWVal : 0,
				memWFwd : undefined,
				aluOp : ALU_OP.NOP,
				aluA : 0,
				aluB : 0,
				aluASrc : 0,
				aluBSrc : 0,
				aluAFwd : undefined,
				aluBFwd : undefined,
				memVal : 0,
				memOp : MEM_OP.NOP,
				memAddr : 0,
				regVal : 0,
				regOp : false,
				regDst : -1,
				regSrc : 0
			});
			// register writeback status table
			// bit 0 : pending writeback
			// bit 1 : value ready
			this.regStatus = [];
			for (var i = 0;i < 32;i++) {
				this.regStatus[i] = 0; 
			}
		}


		function _aReset() {
			this._initPipeline();
			this.cycle = 0;
			this.stalls = 0;
			this.pc = 0x00040000;
			this.branchTarget = undefined;
			this.registerFile[28] = 0x10008000; // $gp
			this.registerFile[29] = 0x7ffffffc; // $sp
		}

		function _aStep() {
			var self = this,
				mem = self.mem,
				r = self.registerFile,
				curPC = self.pc,
				num, tmp,
				uint32tmp = new Uint32Array(2);

			// pipeline shortname
			var if_id = self.if_id,
				id_ex = self.id_ex,
				ex_ma = self.ex_ma,
				ma_wb = self.ma_wb,
				debugInfo = self.debugInfo;

			// fowarding related values
			var writtenRegisterValue,
				loadedMemoryContent,
				updatedALUResult,
				valueToWrite,
				aluA,
				aluB,
				curMemOpEXMA  = ex_ma.memOp,
				curRegDstEXMA = ex_ma.regDst,
				curRegSrcEXMA = ex_ma.regSrc,
				curAluOutEXMA = ex_ma.aluOut,
				curRegDstMAWB = ma_wb.regDst, 	// saved writeback target
				curRegValMAWB = ma_wb.regVal;	// saved writeback value

			// instruction decode
			// oprand source : 0~31 registers, 32 mem, 33 imm
			var curInstIFID, opCode, funcCode, rs, rt, rd, imm, imms, sa,
				newMemLdSgn = false,
				newMemSrc = 0,
				newMemOp = 0,
				newMemVal = 0,
				newAluOp = ALU_OP.NOP,
				newOprA = 0,
				newOprB = 0,
				newOprASrc,
				newOprBSrc,
				newOvEn = false,
				newRegSrc = 0,
				newRegDst = -1,
				cmpSigned = false,
				saInReg = false;

			// branch & exception
			var	prepareBranch = false,
				confirmBranch = false,
				branchTarget,
				branchTargetBase,
				branchTargetOffset = 0,
				branchTargetSrc = 0, // 0~31 registers, 32 pc, 33 pc & 0xf0000000
				branchCond = 0, // 0:unconditional, 1:<, 2:>, 3:<=, 4:>=, 5:=, 6:!=
				branchCondValA, branchCondValB,
				branchCondSrcA = 0,
				branchCondSrcB = 0,
				stopPCUpdate = false,
				insertNOP = false;

			
			var exception = 0;

			debugInfo.stallFlag = 0;

			// ---------------
			// update WB stage
			// ---------------
			if (ma_wb.regDst >= 0) {
				// do things when no branch taken
				// r0 is always 0
				writtenRegisterValue = (ma_wb.regDst != 0) ? ma_wb.regVal : 0;
				r[ma_wb.regDst] = writtenRegisterValue;
				// debug info
				debugInfo.regOp = true;
				debugInfo.regDst = ma_wb.regDst;
				debugInfo.regVal = writtenRegisterValue;
			} else {
				debugInfo.regOp = false;
			}
			self.retiredPC = ma_wb.pc;
			self.retiredInst = ma_wb.inst;

			// ---------------
			// update MA stage
			// ---------------
			// forwarding mux
			// add $r1, $r1, $r1	IF ID EX MA S[WB]
			// sw $r1, 0($r2)		   IF ID EX S[MA] WB
			// 
			// ma_wb not modified here, still valid
			if (ma_wb.regDst == ex_ma.memSrc) {
				valueToWrite = (ma_wb.regDst == 0) ? 0:ma_wb.regVal;
			} else {
				// alway reg --> mem, so memVal cannot come from aluOut
				valueToWrite = ex_ma.memVal;
			}
			// update stage
			// do things when no branch taken
			switch (ex_ma.memOp) {
				case 1: // read byte
					loadedMemoryContent = mem.getByte(ex_ma.aluOut);
					if (ex_ma.memLdSgn && loadedMemoryContent > 127) {
						loadedMemoryContent |= 0xffffff00;
					}
					break;
				case 2: // read halfword
					loadedMemoryContent = mem.getHalfword(ex_ma.aluOut);
					if (ex_ma.memLdSgn && loadedMemoryContent > 32767) {
						loadedMemoryContent |= 0xffff0000;
					}
					break;
				case 3: // read word
					loadedMemoryContent = mem.getWord(ex_ma.aluOut);
					break;
				case 4: // write byte
					mem.setByte(ex_ma.aluOut, valueToWrite);
					break;
				case 5: // write halfword
					mem.setHalfword(ex_ma.aluOut, valueToWrite);
					break;
				case 6: // write word
					mem.setWord(ex_ma.aluOut, valueToWrite);
					break;
				default:
					// do nothing
			}
			// pass register value
			if (ex_ma.regSrc) {
				ma_wb.regVal = loadedMemoryContent;
			} else {
				ma_wb.regVal = ex_ma.aluOut;
			}
			ma_wb.regDst = ex_ma.regDst;
			ma_wb.pc = ex_ma.pc;
			ma_wb.inst = ex_ma.inst;
			// debug info
			debugInfo.memVal = valueToWrite;
			debugInfo.memOp = ex_ma.memOp;
			debugInfo.memSrc = ex_ma.memSrc;
			debugInfo.memAddr = ex_ma.aluOut;
			debugInfo.regSrc = ex_ma.regSrc;
			
			// ---------------
			// update EX stage
			// ---------------
			// forwarding mux
			// 
			// situation I aluOut --> ALUOpr
			// add $r1, $r2, $r0   IF ID EX S[MA] WB
			// add $r3, $r1, $r0      IF ID S[EX] MA WB
			// 
			// add $r1, $r1, $r1	IF ID EX S[MA] WB
			// sw $r3, 0($r1)		   IF ID S[EX] MA WB
			// 
			// situation II regVal --> ALUOpr (possible RAW hazard here) 
			// lw $r1, 0($r2)      IF ID EX MA S[WB]
			// nop                    IF ID EX   MA  WB
			// add $r2, $r1, $r0         IF ID S[EX] MA WB 
			// 
			// ma_wb modified, use copied old value
			// ex_ma not modified here, still valid
			if (id_ex.oprASrc == ex_ma.regDst &&
				ex_ma.regSrc == 0) {
				aluA = (ex_ma.regDst == 0) ? 0:ex_ma.aluOut;
				debugInfo.aluAFwd = 'EX_MA';
			} else if (id_ex.oprASrc == curRegDstMAWB) {
				aluA = writtenRegisterValue;
				debugInfo.aluAFwd = 'MA_WB';
			} else {
				aluA = id_ex.oprA;
				debugInfo.aluAFwd = undefined;
			}
			if (id_ex.oprBSrc == ex_ma.regDst &&
				ex_ma.regSrc == 0) {
				aluB = (ex_ma.regDst == 0) ? 0:ex_ma.aluOut;
				debugInfo.aluBFwd = 'EX_MA';
			} else if (id_ex.oprBSrc == curRegDstMAWB) {
				aluB = writtenRegisterValue;
				debugInfo.aluBFwd = 'MA_WB';
			} else {
				aluB = id_ex.oprB;
				debugInfo.aluBFwd = undefined;
			}
			// update stage
			switch (id_ex.aluOp) {
				// in simulator, aluA and aluB are unsigned number
				// conversion is done in ID stage
				// aluA - reg
				// aluB - reg, imm, sa
				case ALU_OP.ADD: // add
					tmp = ((aluA & 0x80000000) ? 0x100000000 + aluA : aluA) + 
						  ((aluB & 0x80000000) ? 0x100000000 + aluB : aluB);
					break;
				case ALU_OP.SUB: // sub
					tmp = ((aluA & 0x80000000) ? 0x100000000 + aluA : aluA) - 
						  ((aluB & 0x80000000) ? 0x100000000 + aluB : aluB);
					break;
				case ALU_OP.AND: // and
					tmp = aluA & aluB;
					break;
				case ALU_OP.OR: // or
					tmp = aluA | aluB;
					break;
				case ALU_OP.XOR: // xor
					tmp = aluA ^ aluB;
					break;
				case ALU_OP.NOR: // nor
					tmp = ~(aluA | aluB);
					break;
				case ALU_OP.SLL: // sll
					tmp = aluA << (aluB & 0x1f);
					break;
				case ALU_OP.SRL: // srl
					tmp = aluA >>> (aluB & 0x1f);
					break;
				case ALU_OP.SRA: // sra
					tmp = aluA >> (aluB & 0x1f);
					break;
				case ALU_OP.SLT: // less than cmp signed
					tmp = ((aluA|0) < (aluB|0));
					break;
				case ALU_OP.SLTU: // less than cmp unsigned
					tmp = (aluA < aluB);
					break;
				case ALU_OP.MUL: // mul
					tmp = aluA*aluB;
					break;
				case ALU_OP.DIV: // div
					tmp = aluA/aluB;
					break;
				case ALU_OP.NOP:
				default: // pass through
					tmp = aluA;
			}
			if (id_ex.ovEn && (tmp/2 >>> 31)^(tmp >>> 31)) {
				exception |= EXCEPTION_CODE.INT_OVERFLOW;
				// writeback is not performed when exception happend
				ex_ma.regDst = -1;
			} else {
				uint32tmp[0] = tmp;
				ex_ma.aluOut = uint32tmp[0];
				ex_ma.regDst = id_ex.regDst;
			}
			ex_ma.memVal = id_ex.memVal;
			ex_ma.memLdSgn = id_ex.memLdSgn;
			ex_ma.memSrc = id_ex.memSrc;
			ex_ma.memOp = id_ex.memOp;
			ex_ma.regSrc = id_ex.regSrc;
			ex_ma.pc = id_ex.pc;
			ex_ma.inst = id_ex.inst;
			// debug info
			debugInfo.aluA = aluA;
			debugInfo.aluB = aluB;
			debugInfo.aluASrc = id_ex.oprASrc;
			debugInfo.aluBSrc = id_ex.oprBSrc;
			debugInfo.aluOp = id_ex.aluOp;

			// ---------------
			// update ID stage
			// ---------------
			r[0] = 0; // r0 is always 0
			// raw decode
			curInstIFID = if_id.inst,
			opCode = (curInstIFID & 0xfc000000) >>> 26,
			funcCode = curInstIFID & 0x3f,
			rs = (curInstIFID & 0x03e00000) >>> 21, 
			rt = (curInstIFID & 0x001f0000) >>> 16,
			rd = (curInstIFID & 0x0000f800) >>> 11,
			sa = (curInstIFID & 0x000007c0) >>> 6,
			imm = curInstIFID & 0xffff,
			imms = (imm & 0x8000) ? (imm | 0xffff0000) : imm;
			switch (opCode) {
				case 0:
					switch (funcCode) {
						case 0: // sll rd, rt, sa
							newAluOp = ALU_OP.SLL;
							newOprASrc = rt;
							newOprBSrc = 33;
							newRegDst = rd;
							imm = sa; // override imm with sa
							break;
						case 2: // srl rd, rt, sa
							newAluOp = ALU_OP.SRL;
							newOprASrc = rt;
							newOprBSrc = 33;
							newRegDst = rd;
							imm = sa; // override imm with sa
							break;
						case 3: // sra rd, rt, sa
							newAluOp = ALU_OP.SRA;
							newOprASrc = rt;
							newOprBSrc = 33;
							newRegDst = rd;
							imm = sa; // override imm with sa
							break;
						case 4: // sllv rd, rt, rs
							newAluOp = ALU_OP.SLL;
							newOprASrc = rt;
							newOprBSrc = rs;
							newRegDst = rd;
							saInReg = true;
							break;
						case 6: // srlv rd, rt, rs
							newAluOp = ALU_OP.SRL;
							newOprASrc = rt;
							newOprBSrc = rs;
							newRegDst = rd;
							saInReg = true;
							break;
						case 7: // srav rd, rt, rs
							newAluOp = ALU_OP.SRA;
							newOprASrc = rt;
							newOprBSrc = rs;
							newRegDst = rd;
							saInReg = true;
							break;
						case 8: // jr rs
							prepareBranch = true;
							branchTargetSrc = rs;
							break;
						case 13: // break;
							// @TODO Break, current nop
							exception |= EXCEPTION_CODE.BREAK;
							break;
						//case 16: // mfhi
						//case 17: // mthi
						//case 18: // mflo
						//case 19: // mtlo
						case 24: // mult
							newAluOp = ALU_OP.MUL;
							newOprASrc = rs;
							newOprBSrc = rt;
							newRegDst = rd;
							newOvEn = true;
							break;
						case 25: // multu
							newAluOp = ALU_OP.MUL;
							newOprASrc = rs;
							newOprBSrc = rt;
							newRegDst = rd;
							break;
						case 26: // div
							newAluOp = ALU_OP.DIV;
							newOprASrc = rs;
							newOprBSrc = rt;
							newRegDst = rd;
							newOvEn = true;
							break;
						case 27: // divu
							newAluOp = ALU_OP.MUL;
							newOprASrc = rs;
							newOprBSrc = rt;
							newRegDst = rd;
							break;
						case 32: // add rd, rs, rt with overflow check
							newAluOp = ALU_OP.ADD;
							newOprASrc = rs;
							newOprBSrc = rt;
							newRegDst = rd;
							newOvEn = true;
							break;
						case 33: // addu rd, rs, rt
							newAluOp = ALU_OP.ADD;
							newOprASrc = rs;
							newOprBSrc = rt;
							newRegDst = rd;
							break;
						case 34: // sub rd, rs, rt with overflow check
							newAluOp = ALU_OP.SUB;
							newOprASrc = rs;
							newOprBSrc = rt;
							newRegDst = rd;
							newOvEn = true;
							break;
						case 35: // subu rd, rs, rt
							newAluOp = ALU_OP.SUB;
							newOprASrc = rs;
							newOprBSrc = rt;
							newRegDst = rd;
							break;
						case 36: // and rd, rs, rt
							newAluOp = ALU_OP.AND;
							newOprASrc = rs;
							newOprBSrc = rt;
							newRegDst = rd;
							break;
						case 37: // or rd, rs, rt
							newAluOp = ALU_OP.OR;
							newOprASrc = rs;
							newOprBSrc = rt;
							newRegDst = rd;
							break;
						case 38: // xor rd, rs, rt
							newAluOp = ALU_OP.XOR;
							newOprASrc = rs;
							newOprBSrc = rt;
							newRegDst = rd;
							break;
						case 39: // nor rd, rs, rt
							newAluOp = ALU_OP.NOR;
							newOprASrc = rs;
							newOprBSrc = rt;
							newRegDst = rd;
							break;
						case 42: // slt rd, rs, rt
							newAluOp = ALU_OP.SLT;
							newOprASrc = rs;
							newOprBSrc = rt;
							newRegDst = rd;
							break;
						case 43: // sltu rd, rs, rt
							newAluOp = ALU_OP.SLTU;
							newOprASrc = rs;
							newOprBSrc = rt;
							newRegDst = rd;
							break;
						default:
							exception |= INVALID_INST;
					}
					break;
				case 1:
					switch (rt) {
						case 0: // bltz rs, offset
							prepareBranch = true;
							branchTargetOffset = imms << 2;
							branchCondSrcA = rs;
							branchCond = BRANCH_COND.LT;
							break;
						case 16: // bltz rs, offset
							prepareBranch = true;
							branchTargetOffset = imms << 2;
							branchCondSrcA = rs;
							branchCond = BRANCH_COND.LT;
							this.registerFile[31] = this.pc+4;
							break;
						case 1: // bgez rs, offset
							prepareBranch = true;
							branchTargetOffset = imms << 2;
							branchCondSrcA = rs;
							branchCond = BRANCH_COND.GTE;
							break;
						default:
							exception |= INVALID_INST;
					}
					break;
				case 2: // J imm
					prepareBranch = true;
					imm = (curInstIFID & 0x03ffffff) << 2;
					if (imm < 0) imm = imm + 4294967296;
					branchTargetOffset = imm;
					branchTargetSrc = 33; // pc
					break;
				case 3: // JAL imm
					prepareBranch = true;
					this.registerFile[31] = this.pc+4;
					imm = (curInstIFID & 0x03ffffff) << 2;
					if (imm < 0) imm = imm + 4294967296;
					branchTargetOffset = imm;
					branchTargetSrc = 33; // pc
					break;
				case 4: // beq rs, rt, offset
					prepareBranch = true;
					branchTargetSrc = 32;
					branchTargetOffset = imms << 2;
					branchCond = BRANCH_COND.EQ;
					branchCondSrcA = rs;
					branchCondSrcB = rt;
					break;
				case 5: // bne rs, rt, offset
					prepareBranch = true;
					branchTargetSrc = 32;
					branchTargetOffset = imms << 2;
					branchCond = BRANCH_COND.NEQ;
					branchCondSrcA = rs;
					branchCondSrcB = rt;
					break;
				case 6: // blez rs, offset
					prepareBranch = true;
					branchTargetSrc = 32;
					branchTargetOffset = imms << 2;
					branchCond = BRANCH_COND.LTEZ;
					branchCondSrcA = rs;
					branchCondSrcB = 0;
					break;
				case 7: // bgtz rs, offset
					prepareBranch = true;
					branchTargetSrc = 32;
					branchTargetOffset = imms << 2;
					branchCond = BRANCH_COND.GTEZ;
					branchCondSrcA = rs;
					branchCondSrcB = 0;
					break;
				case 8: // addi rt, rs, imm with overflow check
					newAluOp = ALU_OP.ADD;
					newOprASrc = rs;
					newOprBSrc = 33;
					newRegDst = rt;
					newOvEn = true;
					// extend sign
					if (imm & 0x8000) {
						imm += 0xffff0000;
					}
					break;
				case 9: // addiu rt, rs, imm
					newAluOp = ALU_OP.ADD;
					newOprASrc = rs;
					newOprBSrc = 33;
					newRegDst = rt;
					// extend sign
					if (imm & 0x8000) {
						imm += 0xffff0000;
					}
					break;
				case 10: // slti rt, rs, imm
					newAluOp = ALU_OP.SLT;
					newOprASrc = rs;
					newOprBSrc = 33;
					newRegDst = rt;
					// extend sign
					if (imm & 0x8000) {
						imm += 0xffff0000;
					}
					break;
				case 11: // sltiu
					newAluOp = ALU_OP.SLTU;
					newOprASrc = rs;
					newOprBSrc = 33;
					newRegDst = rt;
					// extend sign
					if (imm & 0x8000) {
						imm += 0xffff0000;
					}
					break;
				case 12: // andi rt, rs, imm
					newAluOp = ALU_OP.AND;
					newOprASrc = rs;
					newOprBSrc = 33;
					newRegDst = rt;
					break;
				case 13: // ori rt, rs, imm
					newAluOp = ALU_OP.OR;
					newOprASrc = rs;
					newOprBSrc = 33;
					newRegDst = rt;
					break;
				case 14: // xori rt, rs, imm
					newAluOp = ALU_OP.XOR;
					newOprASrc = rs;
					newOprBSrc = 33;
					newRegDst = rt;
					break;
				case 15: // lui rt, imm
					newAluOp = ALU_OP.ADD;
					newOprASrc = 0;
					newOprBSrc = 33;
					newRegDst = rt;
					imm <<= 16;
					break;
				case 32: // lb rt, offset(rs) sign extended
					newAluOp = ALU_OP.ADD;
					newOprASrc = rs;
					newOprBSrc = 33;
					// extend sign
					if (imm & 0x8000) {
						imm += 0xffff0000;
					}
					newRegDst = rt;
					newMemOp = MEM_OP.RB;
					newRegSrc = 1;
					newMemLdSgn = true;
					break;
				case 33: // lh rt, offset(rs) sign extended
					newAluOp = ALU_OP.ADD;
					newOprASrc = rs;
					newOprBSrc = 33;
					// extend sign
					if (imm & 0x8000) {
						imm += 0xffff0000;
					}
					newRegDst = rt;
					newMemOp = MEM_OP.RHW;
					newRegSrc = 1;
					newMemLdSgn = true;
					break;
				case 35: // lw
					newAluOp = ALU_OP.ADD;
					newOprASrc = rs;
					newOprBSrc = 33;
					// extend sign
					if (imm & 0x8000) {
						imm += 0xffff0000;
					}
					newRegDst = rt;
					newMemOp = MEM_OP.RW;
					newRegSrc = 1;
					newMemLdSgn = true;
					break;
				case 36: // lbu rt, offset(rs)
					newAluOp = ALU_OP.ADD;
					newOprASrc = rs;
					newOprBSrc = 33;
					// extend sign
					if (imm & 0x8000) {
						imm += 0xffff0000;
					}
					newRegDst = rt;
					newMemOp = MEM_OP.RB;
					newRegSrc = 1;
					break;
				case 37: // lhu rt, offset(rs)
					newAluOp = ALU_OP.ADD;
					newOprASrc = rs;
					newOprBSrc = 33;
					// extend sign
					if (imm & 0x8000) {
						imm += 0xffff0000;
					}
					newRegDst = rt;
					newMemOp = MEM_OP.RHW;
					newRegSrc = 1;
					break;
				case 40: // sb rt, offset(rs)
					newAluOp = ALU_OP.ADD;
					newOprASrc = rs;
					newOprBSrc = 33;
					// extend sign
					if (imm & 0x8000) {
						imm += 0xffff0000;
					}
					newMemSrc = rt;
					newMemOp = MEM_OP.WB;
					break;
				case 41: // sh rt, offset(rs)
					newAluOp = ALU_OP.ADD;
					newOprASrc = rs;
					newOprBSrc = 33;
					// extend sign
					if (imm & 0x8000) {
						imm += 0xffff0000;
					}
					newMemSrc = rt;
					newMemOp = MEM_OP.WHW;
					break;
				case 43: // sw rt, offset(rs)
					newAluOp = ALU_OP.ADD;
					newOprASrc = rs;
					newOprBSrc = 33;
					// extend sign
					if (imm & 0x8000) {
						imm += 0xffff0000;
					}
					newMemSrc = rt;
					newMemOp = MEM_OP.WW;
					break;
				case 63: // simulator special
					switch (funcCode) {
						case 0: // print register
							this.eventBus.post('print', 'r' + rs, 'r', r[rs]);
							break;
						case 1: // print memory
							this.eventBus.post('print', '0x' + padLeft(r[rs].toString(16), '0', 8), 'm', mem.getByte(r[rs]))
							break;
						case 2: // print string
							tmp = r[rs];
							var str = '', curChar;
							while ((curChar = mem.getByte(tmp)) != 0) {
								str += String.fromCharCode(curChar);
								tmp++;
							}
							this.eventBus.post('print','0x' + padLeft(r[rs].toString(16), '0', 8), 's', str);
							break;
						default:
					}
					break;
				default:
					exception |= EXCEPTION_CODE.INVALID_INST;
			}

			// forwarding mux
			// 
			// situation I         aluOut --> memVal
			// add $r1, $r0, $r2   IF ID EX S[MA] WB
			// ...
			// sw  $r1, 0($r2)           IF S[ID] EX MA WB
			//
			// situation II      regVal --> memVal
			// ld $r1, 0($r2)    IF ID EX MA S[WB]
			// ...
			// sw $r1, 0($r1)             IF S[ID] EX MA WB
			// 
			// situation III        aluOut --> branchCondValA
			// add $r1, $r0, $r2    IF ID EX S[MA] WB
			// ...
			// bne $r1, $r2, label        IF S[ID] EX MA WB
			// 
			// situation IV         regVal --> branchCondValA
			// ld $r1, 0($r2)       IF ID EX MA S[WB]
			// ...
			// bne $r1, $r2, label           IF S[ID] EX MA WB
			if (newMemOp > 3) {
				// write memory & source register match
				if (curRegDstMAWB == newMemSrc) {
					newMemVal = curRegValMAWB;
					debugInfo.memWFwd = 'MA_WB';
				} else if (curRegDstEXMA == newMemSrc && curRegSrcEXMA == 0) {
					newMemVal = (curRegDstEXMA == 0) ? 0:curAluOutEXMA;
					debugInfo.memWFwd = 'EX_MA';
				} else {
					newMemVal = r[newMemSrc];
					debugInfo.memWFwd = undefined;
				}
				debugInfo.memWSrc = newMemSrc;
				debugInfo.memWVal = newMemVal;
			} else {
				debugInfo.memWSrc = undefined;
			}
			
			if (prepareBranch) {
				if (branchCondSrcA == curRegDstMAWB) {
					branchCondValA = curRegValMAWB;
					debugInfo.bCondAFwd = 'MA_WB';
				} else if (branchCondSrcA == curRegDstEXMA && curRegSrcEXMA == 0) {
					branchCondValA = (curRegDstEXMA == 0) ? 0:curAluOutEXMA;
					debugInfo.bCondAFwd = 'EX_MA';
				} else {
					branchCondValA = r[branchCondSrcA];
					debugInfo.bCondAFwd = undefined;
				}
				if (branchCondSrcB == curRegDstMAWB) {
					branchCondValB = curRegValMAWB;
					debugInfo.bCondBFwd = 'MA_WB';
				} else if (branchCondSrcB == curRegDstEXMA && curRegSrcEXMA == 0) {
					branchCondValB = (curRegDstEXMA == 0) ? 0:curAluOutEXMA;
					debugInfo.bCondBFwd = 'EX_MA';
				} else {
					branchCondValB = r[branchCondSrcB];
					debugInfo.bCondAFwd = undefined;
				}
				if (branchTargetSrc == curRegDstMAWB) {
					branchTargetBase = curRegValMAWB;
					debugInfo.bBaseFwd = 'MA_WB';
				} else if (branchTargetBase == curRegDstEXMA && curRegSrcEXMA == 0) {
					branchTargetBase = (curRegDstEXMA == 0) ? 0:curAluOutEXMA;
					debugInfo.bBaseFwd = 'EX_MA';
				} else {
					if (branchTargetSrc < 32) {
						branchTargetBase = r[branchTargetSrc];
					} else if (branchTargetSrc == 32) {
						branchTargetBase = if_id.pc;
					} else {
						branchTargetBase = if_id.pc & 0xf0000000;
					}
					debugInfo.bBaseFwd = undefined;
				}
			}
			// branch calculation
			if (prepareBranch) {
				// confirm branch
				switch (branchCond) {
					case BRANCH_COND.LTZ:
						confirmBranch = (branchCondValA & 0x80000000);
						break;
					case BRANCH_COND.GTZ:
						confirmBranch = (branchCondValA > 0 && branchCondValA < 0x80000000);
						break;
					case BRANCH_COND.LTEZ:
						confirmBranch = (branchCondValA & 0x80000000) || (branchCondValA == 0);
						break;
					case BRANCH_COND.GTEZ:
						confirmBranch = (branchCondValA < 0x80000000);
						break;
					case BRANCH_COND.EQ:
						confirmBranch = (branchCondValA == branchCondValB);
						break;
					case BRANCH_COND.NEQ:
						confirmBranch = (branchCondValA != branchCondValB);
						break;
					case BRANCH_COND.N:
					default: // do nothing
						confirmBranch = true;
				}
				// branch confirmed
				// calc target pc
				if (confirmBranch) {
					branchTarget = branchTargetOffset + branchTargetBase;
					// check alignment
					// will not branch if exception occurred
					if (branchTarget & 0x03) {
						exception |= PC_ALIGN;
						confirmBranch = false;
					}
				}
			}
			debugInfo.bBaseSrc = branchTargetSrc;
			debugInfo.bCond = prepareBranch ? branchCond : -1;
			debugInfo.bCondAVal = branchCondValA;
			debugInfo.bCondBVal = branchCondValB;
			debugInfo.bCondASrc = branchCondSrcA;
			debugInfo.bCondBSrc = branchCondSrcB;
			debugInfo.bTarget = branchTargetOffset + branchTargetBase;
			debugInfo.bTaken = false;
			// hazard detection
			// global stall on decode stage
			// new instruction will not be fired when hazard detected
			// 
			// RAW
			// situation I   1 bubble
			// lw  $r1, 0($r2)      IF ID EX MA [WB]
			// add $r1, $r0, $r1       IF ID ID [EX] MA WB
			// 
			// situation II  2 bubble
			// lw  $r1, 0($r2)      IF ID EX MA [WB]
			// bne $r1, $r3, label     IF ID ID [ID] EX MA WB
			// 
			// lw  $r1, 0($r2)      IF ID EX MA [WB]
			// sw  $r2, 0($r1)         IF ID ID [ID] EX MA WB
			// 
			// lw  $r1, 0($r4)      IF ID EX MA [WB]
			// nop                     IF ID EX  MA WB
			// bne $r1, $r3, label        IF ID [ID] EX MA WB
			// 
			// situation III 1 bubble
			// add $r1, $r2, $r3    IF ID EX [MA] WB
			// bne $r1, $r2, label     IF ID [ID] EX MA WB
			// 
			// add $r1, $r2, $r3    IF ID EX [MA] WB 	// This should not be a data hazard.
			// sw  $r1, 0($r1)         IF ID [ID] EX MA WB
			// 
			// id_ex not updated, still valid
			
			
			if (id_ex.regDst != 0) {
				// if previous instruction performs memory load
				if (id_ex.memOp > 0 && id_ex.memOp < 4) {
					// arithmetic depend on memory load
					// sI
					if (newOprASrc == id_ex.regDst ||
						newOprBSrc == id_ex.regDst) {
						stopPCUpdate = true;
					}
				}
				// memVal depend
				// sII2, sIII2
				if (newMemOp > 3 &&
					newMemSrc == id_ex.regDst) {
					//stopPCUpdate = true;
				}
				// branch depend on memory load, sII1
				// or arithmetic result, sIII1
				if (prepareBranch) {
					if (branchCondSrcA == id_ex.regDst || 
						branchCondSrcB == id_ex.regDst ||
						branchTargetSrc == id_ex.regDst) {
						
						confirmBranch = false;
						stopPCUpdate = true;
					}
				}
			} else if (curMemOpEXMA > 0 && curMemOpEXMA < 4 && curRegDstEXMA != 0) {
				// if pre-previous instruction performs memory load
				if (prepareBranch) {
					if (branchCondSrcA == curRegDstEXMA || 
						branchCondSrcB == curRegDstEXMA ||
						branchTargetSrc == curRegDstEXMA) {
						// branch depend on memory load, sII3
						confirmBranch = false;
						stopPCUpdate = true;
					}
				}
				if (newMemOp > 3 &&
					newMemSrc == curRegDstEXMA) {
					// This should not be a data hazard.
					//stopPCUpdate = true;
				}
			}
			// write pipeline registers
			if (stopPCUpdate) {
				debugInfo.stallFlag |= STALL_SET.ID;
				// write nop
				id_ex.aluOp = ALU_OP.NOP;
				id_ex.memOp = MEM_OP.NOP;
				id_ex.oprA = 0;
				id_ex.oprB = 0;
				id_ex.oprASrc = 0;
				id_ex.oprBSrc = 0;
				id_ex.regDst = -1;
				id_ex.inst = 0;
				//id_ex.pc = if_id.pc;
				//console.log('Stall!');
			} else {
				newOprA = r[newOprASrc];
				newOprB = (newOprBSrc == 33) ? imm : r[newOprBSrc];
				newOprB = saInReg ? newOprB & 0x1f : newOprB;
				// write new value
				id_ex.aluOp = newAluOp;
				id_ex.memOp = newMemOp;
				id_ex.memLdSgn = newMemLdSgn;
				id_ex.memSrc = newMemSrc;
				id_ex.memVal = newMemVal;
				id_ex.oprA = newOprA;
				id_ex.oprB = newOprB;
				id_ex.oprASrc = newOprASrc;
				id_ex.oprBSrc = newOprBSrc;
				id_ex.ovEn= newOvEn;
				id_ex.regDst = newRegDst;
				id_ex.regSrc = newRegSrc;
				id_ex.sa = newOprB;
				id_ex.rs = rs;
				id_ex.rt = rt;
				id_ex.rd = rd;
				id_ex.imm = imm;
				id_ex.pc = if_id.pc;
				id_ex.inst = if_id.inst;
			}
			// ---------------
			// update IF stage
			// ---------------
			if (mem.busy && mem.unified) {
				// insert nop
				if_id.inst = 0;
				stopPCUpdate = true;
				debugInfo.stallFlag |= STALL_SET.IF;
			} else if (!stopPCUpdate) {
				if_id.inst = mem.getWord(self.pc);
				if_id.pc = self.pc;
			}
			// update pc
			if (confirmBranch) {
				uint32tmp[1] = branchTarget;
				branchTarget = uint32tmp[1];
				self.pc = branchTarget;
				debugInfo.bTaken = true;
			} else if (!stopPCUpdate) {
				self.pc = self.pc + 4;
				if (self.pc > 0xffffffff) 
					self.pc -= 0x100000000;
			} else {
				self.stalls++;
			}
			this.cycle++;

			return exception;

		}
		exports.Core = CPU;
		
		
		return exports;
	})();

	exports.CPU = CPU;

	var Assembler = (function () {

		// TokenList node
		function TokenNode(type) {
			this.type = type;
			this.value = undefined;
			this.offset = undefined;
		}

		// TokenList extending Array
		function TokenList() {
			this._list = [];
		}
		methods(TokenList, {
			getLength : function () {
				return this._list.length;
			},
			getList : function () {
				return this._list;
			},
			get : function (n) {
				return this._list[n];
			},
			push : function () {
				Array.prototype.push.apply(this._list, arguments);
			},
			prepend : function (list) {
				this._list = list.concat(this._list);
			},
			// expect a specified sequence
			// eg. WORD OPR COMMA OPR
			// return matching tokens
			// if keep is true, only return true/false
			// and tokens are not consumed
			expect : function (expectedTypes, keep) {
				var result;
				if (expectedTypes instanceof Array) {
					var match = (this._list.length != 0),
						i, j, cur, optionalOK,
						n = expectedTypes.length;
					// list too short, no need to compare
					if (n > this._list.length) return result;
					// comparation
					for (i = 0;i < n;i++) {
						cur = expectedTypes[i];
						if (cur instanceof Array) {
							// deal with optional types
							optionalOK = false;
							for (j = 0;j < cur.length;j++) {
								optionalOK = optionalOK || (this._list[i].type == cur[j]);
							}
							if (!optionalOK) {
								match = false;
								break;
							}
						} else {
							// deal with strict type
							if (this._list[i].type != cur) {
								match = false;
								break;
							}
						}
					}
					if (match) {
						if (keep) {
							result = true;
						} else {
							result = this._list.splice(0, n);
						}
					}
				} else {
					if (this._list[0] && this._list[0].type == expectedTypes) {
						if (keep) {
							result = true;
						} else {
							result = this._list.splice(0,1)[0];
						}
					}
				}
				return result;
			},
			// expect a constant list
			// eg. 12, 23, 23
			// return an Array of list items
			expectList : function (eleType, sepType) {
				var result = [],
					cur = this.expect(eleType);
				if (cur) {
					result.push(cur.value);
					while ((cur = this.expect([sepType, eleType])) != undefined) {
						result.push(cur[1].value);
					}
					return result;
				} else {
					return undefined;
				}
			}
		});
		


		// strip off comments and split into tokens
		function preprocess(src) {
			var lines = src.split(/\n/);
			for (var i = 0, n = lines.length;i < n;i++) {
				lines[i] = lines[i].replace(/#.*$/, '')
								.trim();
			}
			return lines;
		}

		var regexps = [
			{ n: 'SPECIAL'	, r : /^\.\w+/ },
			{ n: 'LABEL'	, r : /^(\w+):/ },
			{ n: 'STRING'	, r : /^"(([^\\"]|\\.)*)"/ },
			{ n: 'COMMA'	, r : /^\s*,\s*/ },
			{ n: 'SPACE'	, r : /^\s+/ },
			{ n: 'REGOPR'	, r : /^(\$\w{1,2}|zero)/ },
			{ n: 'COMOPR'	, r : /^(-*\d*)\((\$\w{1,2}|zero)\)/ }, // char is also integer
			{ n: 'INTEGER'	, r : /^(0x[\da-f]+|-*\d+|'([^'\\]|\\*)')/ },
			{ n: 'WORD'		, r : /^(\w+)(?!:)/ }
		], 
		tokenRegexps = [],
		TOKEN_TYPES = {},
		tokenTypeNames = [],
		tokenTypeCount = 0;
		// create regexp table
		// do not apply for in loop directly as priority is not ensured!
		for (tokenTypeCount = 0;tokenTypeCount < regexps.length;tokenTypeCount++) {
			tokenRegexps[tokenTypeCount] = regexps[tokenTypeCount].r;
			tokenTypeNames[tokenTypeCount] = regexps[tokenTypeCount].n;
			TOKEN_TYPES[regexps[tokenTypeCount].n] = tokenTypeCount;
		}

		function tokenize(line) {
			var matches, flag, curType,
				tokenList = new TokenList(),
				newNode;
			while (line.length > 0) {
				flag = false;
				for (var i = 0;i < tokenTypeCount;i++) {
					matches = line.match(tokenRegexps[i]);
					if (matches&&matches[0]) {
						newNode = new TokenNode(i);
						switch (i) {
							case TOKEN_TYPES.STRING:
								// preserve original case for string
								newNode.value = matches[1];
								break;
							case TOKEN_TYPES.WORD:
							case TOKEN_TYPES.LABEL:
								newNode.value = matches[1].toLowerCase();
								break;
							case TOKEN_TYPES.COMOPR:
								newNode.offset = parseInt(matches[1]);
								newNode.value = matches[2].toLowerCase();
								break;
							case TOKEN_TYPES.INTEGER:
								if (matches[2]) {
									// preserve original case for char
									newNode.value = matches[2].charCodeAt(0);
								} else {
									newNode.value = parseInt(matches[0]);
								}
								break;
							default:
								newNode.value = matches[0].toLowerCase();
						}
						tokenList.push(newNode);
						line = line.slice(matches.index + matches[0].length);
						flag = true;
						break;
					}
				}
				// no matching syntax
				if (!flag) {
					throw new Error('Unexpected syntax at: '+line);
				}
			}
			return tokenList;
		}

		window.tokenize = tokenize;

		var STORAGE_TYPES = '.space .byte .word .halfword .asciiz .ascii'.split(' '),
			NODE_TYPE = { DATA : 0, TEXT : 1 },
			INST_SIZE = 4,
			INST_TYPES = {},
			INST_TYPE_OPS = [],
			INST_TYPE_COUNT  = 0,
			INST_ALL = CPU.INST_ALL,
			INST_REL_PC = CPU.INST_REL_PC,
			INST_IMM_SHIFT = CPU.INST_IMM_SHIFT,
			INST_UNSIGNED = CPU.INST_UNSIGNED;
		for (var curType in CPU.INST_CAT) {
			INST_TYPE_OPS[INST_TYPE_COUNT] = CPU.INST_CAT[curType];
			INST_TYPES[curType] = INST_TYPE_COUNT;
			INST_TYPE_COUNT++;
		}
		/* pseudo instruction translation table
		 * n - instruction name
		 * e - expected tokens (do not include heading and trailing space)
		 * t - translation format
		 * 		{n} --> expectedToken[n].value
		 * 		use {n.offset} to access offset property of COMOPR token
		 * 		use {n.H} and {n.L} to access higher 16 bits and lower 
		 * 			16 bits of integer value respectively
		 * 		use __h16__ and __l16__ prefix if you want translator only
		 * 			use higher or lower 16 bits of the resolved address
		 * 			of the corresponding label
		 */
		var PI_TABLE = [
			{ // load address : la $rn, label
				n : 'la',
				e : [
			  		TOKEN_TYPES.REGOPR,
			  		TOKEN_TYPES.COMMA,
			  		TOKEN_TYPES.WORD
			  	],
			  	t : 'lui $r1,__h16__{2} ' +
			  		'ori {0},$r1,__l16__{2}'
			},{ // load immediate : li $rn, imm32
				n : 'li',
				e : [
			  		TOKEN_TYPES.REGOPR,
			  		TOKEN_TYPES.COMMA,
			  		TOKEN_TYPES.INTEGER
			  	],
			  	t : 'lui $r1,{2.H} ' +
			  		'ori {0},$r1,{2.L}'
			},{ // push register : pushr $rn
				n : 'pushr',
				e : [
					TOKEN_TYPES.REGOPR
				],
				t : 'sw {0},0($sp)' +
					'addi $sp,$sp,-4'
			},{ // pop to register : pushr $rn
				n : 'popr',
				e : [
					TOKEN_TYPES.REGOPR
				],
				t : 'lw {0},4($sp)' +
					'addi $sp,$sp,4'
			}
		],
		PI_COUNT,
		PI_NAMES = [],
		PI_EXPECTS = [],
		PI_TRANSLATION = [];
		for (PI_COUNT = 0;PI_COUNT < PI_TABLE.length;PI_COUNT++) {
			PI_NAMES.push(PI_TABLE[PI_COUNT].n);
			PI_EXPECTS.push(PI_TABLE[PI_COUNT].e);
			PI_TRANSLATION.push(PI_TABLE[PI_COUNT].t);
		}
		var SHARED_INST = overlap(PI_NAMES, INST_ALL);

		function alignSize(size) {
			return 4*(Math.floor((size-0.1)/4.0)+1);
		}

		function convertWord(n) {
			if (n > 2147483647) n = 2147483647;
			if (n < -2147483648) n = -2147483648;
			return (n < 0) ? 4294967296 + n : n;
		}

		function convertHalfword(n) {
			if (n > 32767) n = 32767;
			if (n < -32768) n = -32768;
			return (n < 0) ? 65536 + n : n;
		}

		function convertByte(n) {
			if (n > 127) n = 127;
			if (n < -128) n = -128;
			return (n < 0) ? 256 + n : n;
		}

		// pack string into memory binary
		function packString(str) {
			var i, n, res = [];
			n = str.length;
			for (i = 3;i < n;i+=4) {
				res.push((str.charCodeAt(i-3) * 16777216) +
						 (str.charCodeAt(i-2) << 16) +
						 (str.charCodeAt(i-1) << 8) +
						 (str.charCodeAt(i)));
			}
			i = n - i + 3;
			if (i == 0) {
				res.push(0);
			} else if (i == 1) {
				res.push(str.charCodeAt(n-1) * 16777216);
			} else if (i == 2) {
				res.push(str.charCodeAt(n-2) * 16777216 +
						 str.charCodeAt(n-1) << 16);
			} else {
				res.push(str.charCodeAt(n-3) *16777216 +
						 (str.charCodeAt(n-2) << 16) +
						 (str.charCodeAt(n-1) << 8));
			}
			return res;
		}

		window.packString = packString;

		// pack integer list into memory binary
		function packIntegers(list, unitSize) {
			var result = [], i, n, t;
			if (unitSize == 4) {
				n = list.length;
				for (i = 0;i < n;i++) {
					result.push(convertWord(list[i]));
				}
			} else if (unitSize == 2) {
				n = list.length;
				if (n%2!=0) {
					list.push(0);
					n++;
				}
				for (i = 0;i < n;i+=2) {
					result.push(convertHalfword(list[i]) * 65536 +
								convertHalfword(list[i+1]));
				}
			} else if (unitSize == 1) {
				n = list.length;
				t = 4 - n%4;
				if (t < 4) {
					for (i = 0;i < t;i++) {
						list.push(0);
					}
					n += t;
				}
				for (i = 0;i < n;i+=4) {
					result.push(convertByte(list[i]) * 16777216 +
								(convertByte(list[i+1]) << 16) +
								(convertByte(list[i+2]) << 8) +
								convertByte(list[i+3]));
				}
			} else {
				throw new Error('Invaid unit size for alignment.')
			}
			return result;
		}

		window.packIntegers = packIntegers;

		// create a data node for future translation
		// alignment is automatically enforced
		function createDataNode(tokenList, type, curAddr, lineno) {
			var curToken, unitSize,
				newSize, newData,
				result = {
					type : NODE_TYPE.DATA,
					addr : curAddr,
					line : lineno
				};
			if (type == '.space') {
				// allocate new space, no specific data needed
				curToken = tokenList.expect(TOKEN_TYPES.INTEGER);
				if (curToken) {
					newSize = alignSize(curToken.value);
					result.size = newSize;
					result.data = undefined;
				} else {
					throw new Error('No size specified for .space.');
				}
			} else if (type == '.asciiz' || type == '.ascii') {
				// string
				curToken = tokenList.expect(TOKEN_TYPES.STRING);
				if (curToken) {
					newData = packString(curToken.value);
					result.size = newData.length * 4;
					result.data = newData;
				} else {
					throw new Error('No string specified for .asciiz');
				}
			} else {
				// other data
				switch (type) {
					case '.byte' : unitSize = 1; break;
					case '.halfword' : unitSize = 2; break;
					default : unitSize = 4 // word
				}
				newData = tokenList.expectList(TOKEN_TYPES.INTEGER, TOKEN_TYPES.COMMA);
				if (newData) {
					newData = packIntegers(newData, unitSize);
					result.size = newData.length * 4;
					result.data = newData;
				} else {
					throw new Error('No data found after ' + type);
				}
			}
			return result;
		}

		// check if immediate number is within valid range
		function checkImmediateRange(imm, instName) {
			if (typeof(imm) == 'string') {
				// ignore label here
				// label should be resolved later
				return true;
			}
			if (INST_IMM_SHIFT.indexOf(instName) >= 0) {
				// shift 0~31
				if (imm < 0 || imm > 31) {
					throw new Error('Shift amount ' + imm + ' out of range (0~31)');
					return false;
				}
			} else {
				// integer
				if (INST_UNSIGNED.indexOf(instName) >= 0) {
					// unsigned 0~65535
					if (imm < 0 || imm > 65535) {
						throw new Error('Unsigned integer ' + imm + ' out of range (0~65535)');
						return false;
					}
				} else {
					// signed -32768~32767
					if (imm < -32768 || imm > 32767) {
						throw new Error('Signed integer ' + imm + ' out of range (-32768~32767)');
						return false;
					}
				}
			}
			return true;
		}

		// create an instruction node for future translation
		function createInstructionNode(tokenList, instName, curAddr, lineno) {
			var result = { // node template
				type : NODE_TYPE.TEXT,
				inst : instName,
				addr : curAddr,
				size : INST_SIZE,
				rs : undefined,
				rd : undefined,
				rt : undefined,
				imm : undefined,
				line : lineno
			}, expectedTokens, tmp, type, i;
			type = -1;
			// get instruction format type
			for (i = 0;i < INST_TYPE_COUNT;i++) {
				if (INST_TYPE_OPS[i].indexOf(instName) >= 0) {
					type = i;
					break;
				}
			}
			if (type < 0) {
				throw new Error('Unknown instruction ' + instName);
			}
			// interpret
			switch (type) {
				case INST_TYPES.RRR: // e.g. add rd, rs, rt
					expectedTokens = tokenList.expect([
						TOKEN_TYPES.REGOPR,
						TOKEN_TYPES.COMMA,
						TOKEN_TYPES.REGOPR,
						TOKEN_TYPES.COMMA,
						TOKEN_TYPES.REGOPR
					]);
					if (expectedTokens) {
						result.rd = expectedTokens[0].value;
						result.rs = expectedTokens[2].value;
						result.rt = expectedTokens[4].value;
					} else {
						throw new Error('Expecting 3 register operands for ' + instName);
					}
					break;
				case INST_TYPES.RRI: // e.g. addi rt, rs, imm
					expectedTokens = tokenList.expect([
						TOKEN_TYPES.REGOPR,
						TOKEN_TYPES.COMMA,
						TOKEN_TYPES.REGOPR,
						TOKEN_TYPES.COMMA,
						[TOKEN_TYPES.WORD, TOKEN_TYPES.INTEGER]
					]);
					if (expectedTokens) {
						result.rt = expectedTokens[0].value;
						result.rs = expectedTokens[2].value;
						// check range
						tmp = expectedTokens[4].value;
						if (checkImmediateRange(tmp, instName)) {
							result.imm = tmp;
						}
					} else {
						throw new Error('Expecting 2 register operands and 1 immediate for ' + instName);
					}
					break;
				case INST_TYPES.RRA: // e.g. sll rd, rt, amount
					expectedTokens = tokenList.expect([
						TOKEN_TYPES.REGOPR,
						TOKEN_TYPES.COMMA,
						TOKEN_TYPES.REGOPR,
						TOKEN_TYPES.COMMA,
						TOKEN_TYPES.INTEGER
					]);
					if (expectedTokens) {
						result.rd = expectedTokens[0].value;
						result.rt = expectedTokens[2].value;
						// check range
						tmp = expectedTokens[4].value;
						if (checkImmediateRange(tmp, instName)) {
							result.imm = tmp;
						}
					} else {
						throw new Error('Expecting 2 register operands and 1 immediate for ' + instName);
					}
					break;
				case INST_TYPES.RC: // e.g. lw rt, offset(base)
					expectedTokens = tokenList.expect([
						TOKEN_TYPES.REGOPR,
						TOKEN_TYPES.COMMA,
						TOKEN_TYPES.COMOPR
					]);
					if (expectedTokens) {
						result.rt = expectedTokens[0].value;
						result.rs = expectedTokens[2].value;
						// check offset range
						tmp = expectedTokens[2].offset;
						if (tmp >= -32768 && tmp < 32768) {
							result.imm = tmp;
						} else {
							throw new Error('Offset value '+ tmp + ' out of range (-32768~32767).');
						} 
					} else {
						throw new Error('Expecting 1 register operand and 1 immediate for ' + instName);
					}
					break;
				case INST_TYPES.RI: // e.g. blez rs, imm
					expectedTokens = tokenList.expect([
						TOKEN_TYPES.REGOPR,
						TOKEN_TYPES.COMMA,
						[TOKEN_TYPES.WORD, TOKEN_TYPES.INTEGER]
					]);
					if (expectedTokens) {
						result.rs = expectedTokens[0].value;
						result.imm = expectedTokens[2].value;
					} else {
						throw new Error('Expecting 1 register operand and 1 immediate for ' + instName);
					}
					break;
				case INST_TYPES.R: // e.g. jr rs
					expectedTokens = tokenList.expect([
						TOKEN_TYPES.REGOPR,
					]);
					if (expectedTokens) {
						result.rs = expectedTokens[0].value;
					} else {
						throw new Error('Expecting 1 register operand for ' + instName);
					}
					break;
				case INST_TYPES.I:
					expectedTokens = tokenList.expect([
						[TOKEN_TYPES.WORD, TOKEN_TYPES.INTEGER]
					]);
					if (expectedTokens) {
						result.imm = expectedTokens[0].value;
					} else {
						throw new Error('Expecting 1 immediate for ' + instName);
					}
					break;
				case INST_TYPES.N:
					// nothing to expect, do nothing
					break;
				default:
					throw new Error('Unrecongnized instruction type ' + type);
			}
			result.addr = curAddr;
			return result;
		}

		function expandPseudoInstruction(tokens, type) {
			var instName = PI_NAMES[type],
				expectations = PI_EXPECTS[type],
				newCode = PI_TRANSLATION[type],
				expectedTokens;
			expectedTokens = tokens.expect(expectations);
			if (expectedTokens) {
				newCode = newCode.replace(/\{(\d+)\.*(.*?)\}/g, function (match, p1, p2) {
					var n = parseInt(p1), newVal;
					if (isNaN(n) || n < 0 || n >= expectedTokens.length) {
						throw new Error('Invalid index ' + p1 + ' in format string.');
					}
					if (p2) {
						// has sub attributes
						if (p2 == 'L') {
							newVal = parseInt(expectedTokens[n].value) & 0xffff;
						} else if (p2 == 'H') {
							newVal = parseInt(expectedTokens[n].value) >>> 16;
						} else {
							newVal = expectedTokens[n][p2];
						}
						if (newVal == undefined) {
							throw new Error('Attribute ' + p2 + ' is undefined.');
						}
						return String(newVal);
					} else {
						return String(expectedTokens[n].value);
					}
				});
				return tokenize(newCode).getList();
			} else {
				throw new Error('Syntax error near pseudo instruction ' + instName);
			}
			return undefined;
		}

		// parse a TokenList
		// return {
		// 	type : 0 - data, 1 - text
		//  addr : actually the size here, in byte
		//  when data include data 
		//  when text include inst, rs, rd, rt, imm
		// }
		function parseLine(tokens, lineno, symbols, status) {
			var relAddr = 0, curToken, i, flag, tokenRecognized,
				curLine, rs, rt, rd, inst, func, idx,
				tmp, result = [];
			while (tokens.getLength() > 0) {
				// consume white space
				tokens.expect(TOKEN_TYPES.SPACE);
				tokenRecognized = false;
				// label
				curToken = tokens.expect(TOKEN_TYPES.LABEL);
				if (curToken) {
					// consume white space
					tokens.expect(TOKEN_TYPES.SPACE);
					if (symbols[curToken.value]) {
						throw new Error('Symbol "' + curToken.value + '" is redefined!');
					} else {
						symbols[curToken.value] = (status.section == 'text') ?
													status.textCurrentAddr : status.dataCurrentAddr;
					}
					tokenRecognized = true;
				}
				// specials
				curToken = tokens.expect(TOKEN_TYPES.SPECIAL);
				if (curToken) {
					// consume white space
					tokens.expect(TOKEN_TYPES.SPACE);
					if (curToken.value == '.data') {
						// change to data section
						status.section = 'data';
					} else if (curToken.value == '.text') {
						// change to text section
						status.section = 'text';
					} else if (STORAGE_TYPES.indexOf(curToken.value) >= 0) {
						if (status.section != 'data') {
							throw new Error('Cannot allocate data in text section.')	
						}
						// allocate storage
						tmp = createDataNode(tokens, curToken.value, status.dataCurrentAddr, lineno);
						status.dataCurrentAddr += tmp.size; // update global data pointer address
						status.dataSize += tmp.size;
						result.push(tmp);
					} else {
						throw new Error('Unexpected syntax near ' + curToken.value);
					}
					tokenRecognized = true;
				}
				// instructions
				curToken = tokens.expect(TOKEN_TYPES.WORD);
				if (curToken) {
					if (status.section != 'text') {
						throw new Error('Instructions cannot be put into data section.')
					}
					// consume white space
					tokens.expect(TOKEN_TYPES.SPACE);
					tokenRecognized = true;
					inst = curToken.value;
					flag = false;
					// check if it is pseudo instruction
					if ((idx = PI_NAMES.indexOf(inst)) >= 0) {
						if (SHARED_INST.indexOf(inst) >= 0) {
							// attempt to interpret as pseudo instruction first
							// if name conflict found
							if (tokens.expect(PI_EXPECTS[idx], true)) {
								tokens.prepend(expandPseudoInstruction(tokens, idx));
								flag = true;
							}
							// unable to interpret as pseudo instruction
							// pass to normal interpreter
						} else {
							// expand normal pseudo instruction
							// prepend new tokens to the beginning
							tokens.prepend(expandPseudoInstruction(tokens, idx));
							flag = true;
						}
						
					}
					if (!flag) {
						// interpret as normal instruction
						tmp = createInstructionNode(tokens, curToken.value, status.textCurrentAddr, lineno);
						status.textCurrentAddr += tmp.size; // update global text pointer address
						status.textSize += tmp.size;
						result.push(tmp);
					}
				}
				if (!tokenRecognized) {
					throw new Error('Unexpected syntax near : ' + tokens.get(0).value);
				}
			}
			return result;
		}

		var regAliases = ('zero $at $v0 $v1 $a0 $a1 $a2 $a3 ' +
						  '$t0 $t1 $t2 $t3 $t4 $t5 $t6 $t7 ' +
						  '$s0 $s1 $s2 $s3 $s4 $s5 $s6 $s7 ' +
						  '$t8 $t9 $k0 $k1 $gp $sp $fp $ra').split(' ');
		function convertRegName(regname) {
			// GPRs only
			var idx;
			if (regname == 'zero') {
				return 0;
			} else if ((idx = regAliases.indexOf(regname)) >= 0) {
				return idx;
			} else {
				var match = regname.match(/\d+/),
					n;
				if (match) {
					n = parseInt(match[0]);
					if (n >= 0 && n < 32) return n;
				}
			}
			// no match
			throw new Error('Invalid register name ' + regname);
		}

		function resolveSymbols(list, symbols, aliases) {
			var n = list.length, i, cur, newVal, 
				needHigh16Bits, needLow16Bits;
			for (i = 0;i < n;i++) {
				cur = list[i];
				if (cur.type == NODE_TYPE.DATA) continue;
				if (typeof(cur.rt) == 'string') {
					cur.rt = convertRegName(cur.rt);
				}
				if (typeof(cur.rs) == 'string') {
					cur.rs = convertRegName(cur.rs);
				}
				if (typeof(cur.rd) == 'string') {
					cur.rd = convertRegName(cur.rd);
				}
				if (typeof(cur.imm) == 'string') {
					// resolve label
					// check internal operator
					if (cur.imm.indexOf('__h16__') == 0) {
						needHigh16Bits = true;
						needLow16Bits = false;
						cur.imm = cur.imm.slice(7);
					}
					if (cur.imm.indexOf('__l16__') == 0) {
						needLow16Bits = true;
						needHigh16Bits = false;
						cur.imm = cur.imm.slice(7);
					}
					newVal = symbols[cur.imm];
					if (newVal == undefined) {
						throw new Error('Undefined symbol '+cur.imm);
					} else {
						if (cur.inst == 'j' || cur.inst == 'jal') {
							// special absolute jump
							newVal = newVal >> 2;
						} else if (INST_REL_PC.indexOf(cur.inst) >= 0) {
							// check if using relative PC
							// calculate relative offset
							newVal = (newVal - cur.addr) >> 2;
							if (newVal < -32768 || newVal > 32767) {
								throw new Error('Target "' + cur.imm + '" too far way.');
							}
						} else {
							// check if masking is needed
							if (needLow16Bits) newVal = newVal & 0xffff;
							if (needHigh16Bits) newVal = newVal >>> 16;
						}
						cur.imm = newVal;
					}
				}
			}
		}

		// translate into machine code
		function translate(list, text, data, statusTable) {
			var n = list.length, i, j, k, cur, si, ei;
			for (i = 0;i < n;i++) {
				cur = list[i];
				if (cur.type == NODE_TYPE.DATA) {
					if (cur.data) {
						// copy data
						si = (cur.addr - statusTable.dataStartAddr) >> 2;
						ei = si + (cur.size >> 2);
						for (j = si, k = 0;j < ei;j++, k++) {
							data[j] = cur.data[k];
						}
					} else {
						// other wise fill with zeros
						si = (cur.addr - statusTable.dataStartAddr) >> 2;
						ei = si + (cur.size >> 2);
						for (j = si;j < ei;j++) {
							data[j] = 0;
						}
					}
				} else {
					si = (cur.addr - statusTable.textStartAddr) >> 2;
					text[si] = CPU.translators[cur.inst](cur);					
				}
			}
		}

		// generate source map
		function generateSourceMap(list, statusTable) {
			var n = list.length, i,
				ret = [];
			for (i = 0;i < n;i++) {
				cur = list[i];
				if (cur.type == NODE_TYPE.TEXT) {
					ret[(cur.addr - statusTable.textStartAddr) >> 2] = cur.line;
				}
			}
			return ret;
		}

		// return data, memory array, their size and offset,
		// and source map
		function assemble(src, config) {
			var lines = preprocess(src),
				i, n = lines.length,
				symbolTable = {},
				statusTable = {
					section: 'text',
					textSize : 0,
					dataSize : 0,
					dataStartAddr : 0,	// data section start address
					dataCurrentAddr : 0,	// data section current address
					textStartAddr : 0,	// text section start address
					textCurrentAddr : 0		// text section current address					
				},
				aliasTable = {},
				curTokenList,
				infoList = [];
			config = extend({}, config);
			// apply user defined properties
			statusTable.dataStartAddr = (config.dataStartAddr != undefined) ? config.dataStartAddr : 0x10000000;
			statusTable.textStartAddr = (config.textStartAddr != undefined) ? config.textStartAddr : 0x00040000;
			statusTable.dataCurrentAddr = statusTable.dataStartAddr;
			statusTable.textCurrentAddr = statusTable.textStartAddr;
			// generate infomation list
			for (i = 0;i < n;i++) {
				try {
					curTokenList = tokenize(lines[i]);
					infoList.push.apply(infoList, parseLine(curTokenList, i+1, symbolTable, statusTable));
				} catch (err) {
					throw new Error('L' + (i+1) + ':' + err.message);
				}
			}
			//console.log(infoList);
			// resolve symbols and alias
			resolveSymbols(infoList, symbolTable, statusTable);

			// translate
			// check section confliction
			var dStart = statusTable.dataStartAddr,
				dEnd = statusTable.dataStartAddr + statusTable.dataSize,
				tStart = statusTable.textStartAddr,
				tEnd = statusTable.textStartAddr + statusTable.textSize;
			if (!(dEnd < tStart || dStart > tEnd)) {
				throw new Error('Overlap detected between data section and text section.');
			}
			var dataMem = [], textMem = [];
			translate(infoList, textMem, dataMem, statusTable);
			
			return {
				dataStart : statusTable.dataStartAddr,
				textStart : statusTable.textStartAddr,
				dataSize : statusTable.dataSize,
				textSize : statusTable.textSize,
				dataMem : dataMem,
				textMem : textMem,
				sourceMap : generateSourceMap(infoList, statusTable),
				symbolTable : symbolTable
			};
		}

		function disassemble(inst) {
			// @todo
			var opcode = (inst & 0xfc000000) >>> 26,
				func = inst & 0x3f,
				rs = (inst & 0x03e00000) >>> 21, 
				rt = (inst & 0x001f0000) >>> 16,
				rd = (inst & 0x0000f800) >>> 11,
				a = (inst & 0x000007c0) >>> 6,
				imm = inst & 0xffff,
				imms = (imm & 0x8000) ? (imm | 0xffff0000) : imm; // sign-extended imm
			var str;
			switch (opcode) {
				case 0:
					switch (func) {
						case 0:
							if (rd == 0 && rt == 0 && a == 0) {
								str = 'nop (sll $r0, $r0, 0)';
							} else {
								str = 'sll rd, rt, sa';
							}
							break;
						case 2: str = 'srl rd, rt, sa'; break;
						case 3: str = 'sra rd, rt, sa'; break;
						case 4: str = 'sllv rd, rt, rs'; break;
						case 6: str = 'srlv rd, rt, rs'; break;
						case 7: str = 'srav rd, rt, rs'; break;
						case 8: str = 'jr rs'; break;
						case 13: str = 'break'; break;
						//case 16: // mfhi
						//case 17: // mthi
						//case 18: // mflo
						//case 19: // mtlo
						//case 24: // mult
						//case 25: // multu
						//case 26: // div
						//case 27: // divu
						case 32: str = 'add rd, rs, rt'; break;
						case 33: str = 'addu rd, rs, rt'; break;
						case 34: str = 'sub rd, rs, rt'; break;
						case 35: str = 'subu rd, rs, rt'; break;
						case 36: str = 'and rd, rs, rt'; break;
						case 37: str = 'or rd, rs, rt'; break;
						case 38: str = 'xor rd, rs, rt'; break;
						case 39: str = 'nor rd, rs, rt'; break;
						case 42: str = 'slt rd, rs, rt'; break;
						case 43: str = 'sltu rd, rs, rt'; break;
						default: str = 'unknown'; break;
					}
					break;
				case 1:
					switch (rt) {
						case 0: str = 'bltz rs, offset'; break;
						case 16: str = 'bltzal rs, offset'; break;
						case 1: str = 'bgez rs, offset'; break;
						default: str = 'unknown'; break;
					}
					break;
				case 2:
					str = 'j addr';
					imm = inst & 0x03ffffff;
					if (imm < 0) imm = imm + 4294967296;
					break;
				case 3:
					str = 'jal addr';
					imm = inst & 0x03ffffff;
					if (imm < 0) imm = imm + 4294967296;
					break;
				case 4: str = 'beq rs, rt, offset'; break;
				case 5: str = 'bne rs, rt, offset'; break;
				case 6: str = 'blez rs, offset'; break;
				case 7: str = 'bgtz rs, offset'; break;
				case 8: str = 'addi rt, rs, imm'; break;
				case 9: str = 'addiu rt, rs, imm'; break;
				case 10: str = 'slti rt, rs, imm'; break;
				case 11: str = 'sltiu rt, rs, imm'; break;
				case 12: str = 'andi rt, rs, imm'; break;
				case 13: str = 'ori rt, rs, imm'; break;
				case 14: str = 'xori rt, rs, imm'; break;
				case 15: str = 'lui rt, imm'; break;
				case 32: str = 'lb rt, offset(rs)'; break;
				case 33: str = 'lh rt, offset(rs)'; break;
				case 35: str = 'lw'; break;
				case 36: str = 'lbu rt, offset(rs)'; break;
				case 37: str = 'lhu rt, offset(rs)'; break;
				case 40: str = 'sb rt, offset(rs)'; break;
				case 41: str = 'sh rt, offset(rs)'; break;
				case 43: str = 'sw rt, offset(rs)'; break;
				case 63: // simulator special
					switch (func) {
						case 0: str = 'print rs'; break;
						case 1: str = 'printm rs'; break;
						case 2: str = 'prints rs'; break;
						default: str = 'unknown'; break;
					}
					break;
				default: str = 'unknown'; break;
			}
			return str.replace('rs', '$r'+rs)
					  .replace('rt', '$r'+rt)
					  .replace('rd', '$r'+rd)
					  .replace('sa', a)
					  .replace('addr', '0x'+imm.toString(16))
					  .replace('offset', '0x'+imm.toString(16))
					  .replace('imm', imm);
		}

		return {
			assemble : assemble,
			disassemble : disassemble
		};

	})();
	exports.Assembler = Assembler;

	return exports;

})();
