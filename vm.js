//by FF
'use strict';


/*
new $.Lexer('a+b').calc([{a:1, b:2}], true);

config:
	isLet: the assign operators will not affect not current scope

config for scopes:
	start: the scope before start can't be assign

support:
	all operators, new support at most 4 arguments
	json
	array
	string
	number
	function calling
	; to join 2 or more expressions, or end with it, but only one is allowed

not support:
	all statements
	function(){}
	/xxx/gim
	new (a.b), will be parsed as this.new(a.b), use new a.b. delete, typeof, viod same with new
*/
$.Lexer = $({
	/*
	match whole exression, get the below parts
	match 1: ''
	match 2: ""
	match 3: number
	match 4: variable, may delete or in...
	match 5: operator
	*/
	re : /('(?:\\'|[^'])*?')|("(?:\\"|[^"])*?")|((?:0x\d+|\d*\.\d+|\d+)(?:e\d+)?)|([a-z_$][\w$]*)|(;|[.+\-~!*\/%<>=&^|?:,]+)|([\[\](){}])/gi,

	brackets : '([{}])',

	//if want to access these as property, use this.xxx
	keywords : {
		'true'			: true,
		'false'			: false,
		'null'			: null,
		'undefined'		: undefined,
		'JSON'			: JSON,
		'Array' 		: Array,
		'Boolean'		: Boolean,
		'Number'		: Number,
		'String'		: String,
		'Math'			: Math,
		'NaN'			: NaN,
		'Infinity'		: Infinity,
		'isFinite'		: isFinite,
		'isNaN'			: isNaN,
		'parseFloat'	: parseFloat,
		'parseInt'		: parseInt
	},

	/*{.:{priority:15, where:b}, -?:{priority:14,where:l}, -{priority:12,where:b}}
	contains
		value
		priority
		where
		assign
		single

	self defined operators:
		{: create object
		[: create array
		(: function call
		@: get attribute from current scope
		++?: ++a
		--?: --a
		-?: negative value
	*/

	operators : (function(){
		var properties = $.unCategory([
			'. [ ( {',	//a[], a(), only left parts are recognized as operator
			'++ -- ++? --? -? ~ ! delete typeof void new @',
			'* / %',
			'+ -',
			'<< >> >>>',
			'< <= > >= in instanceof',
			'== != === !==',
			'&',
			'^',
			'|',
			'&&',
			'||',
			'? :',
			'= += -= *= /= %= <<= >>= >>>= &= ^= |=',
			',',
			';'
		].reverse());

		//operator type: left, right, binary, format: {-:[l, r]}
		var wheres = $.unCategory({
			'l' : '++? --? -? ~ ! delete typeof void new @',
			'r' : '++ --',
			'b' : '. [ ( * / % + - << >> >>> < <= > >= in instanceof == != === !== & ^ | && || ? : = += -= *= /= %= <<= >>= >>>= &= ^= |= , ;'
		});

		var opt = {};

		for(var value in properties){
			var priority = properties[value],
				where = wheres[value];

			opt[value] = {
				value : value,
				priority : priority,
				where : where,
				single : where !== 'b',
				assign : priority === 2 || value === '++' || value === '--' || value === '++?' || value === '--?'
			};
		}

		return opt;
	})(),

	//get operator by original operator like ++, --, - and where, can be l or br
	getOperator : function(value, where){
		if(where === 'l' && (value === '++' || value === '--' || value === '-')){
			value = value + '?';
		}

		return this.operators[value];
	},

	init : function(expression, isLet){
		this.isLet = Boolean(isLet);

		//vars cache all the variables, for example a.b, cache a and a.b
		this.vars = [];
		//for a.b, cache a.b, not a
		this.strictVars = [];
		//for a.b = c; cache a.b, a.b will be assigned. a.b(), delete a.b will not trigger assign
		this.assignVars = [];

		this.arrs = this.parseExpsToArrs(this.compileExps(expression));
	},

	//no argument to return has variable or not
	hasVar : function(){
		if(arguments.length === 0){
			return this.vars.length > 0;
		}
		else{
			for(var i in arguments){
				if(this.vars.contains(arguments[i])){
					return true;
				}
			}
			return false;
		}
	},

	hasStrictVar : function(){
		if(arguments.length === 0){
			return this.strictVars.length > 0;
		}
		else{
			for(var i in arguments){
				if(this.strictVars.contains(arguments[i])){
					return true;
				}
			}
			return false;
		}
	},

	/*
	type:
		v: value, string or number
		p: property
		o: operator
		b: bracket
	value: 
	where: l, r, b
	couple: another couple part for brackets
	begining: for brackets
	priority: if [ ( as operator, has this property too
	comma: (,) or [,] or {,}
	*/
	compileExps : function(expression){
		this.source = expression;

		var exps = [],
			prevExp = null,
			brackets = [],	//contains ? :
			expect = 'v';

		expression.replace(this.re, (function(){
			var args = $.array(arguments),
				value = args[1] || args[2] || args[3] || args[4] || args[5] || args[6],
				exp = {index : args[7]/*, startValue : value*/};

			//string
			if(args[1] || args[2]){
				exp.type = 'v';
				exp.value = String.jsDecode(value.slice(1, -1));
			}

			//number
			else if(args[3]){
				exp.type = 'v';
				exp.value = Number(value);
			}

			//property
			else if(args[4]){
				//expect i or prev is .
				if(expect === 'i' || prevExp && prevExp.type === 'o' && prevExp.value === '.'){
					exp.type = 'v';
					exp.value = String(value);
				}
				else{
					exp.type = 'p';
					exp.value = value;
					//delete a, a instanceof b, and expect is v or o, process them as operator
					if(value in this.operators){
						if(expect === 'o'){
							var o = this.getOperator(value, 'br');
							if(o){
								exp.type = 'o';
								$.apply(exp, o);
							}
						}
						//like new() or new a(), we don't know new is operator or property
						else if(this.getOperator(value, 'l')){
							exp.mayOperator = true;
						}
					}
					else if(value in this.keywords){
						//exclude like ++true, which true will be parsed as property
						if(!(prevExp && prevExp.where === 'l' && prevExp.assign)){
							exp.mayKeyWord = true;
						}
					}
				}
			}

			//operator
			else if(args[5]){
				if(value in this.operators){
					exp.type = 'o';
					$.apply(exp, this.getOperator(value, expect === 'v' ? 'l' : 'br'));

					//when ?, create a new bracket
					if(value === '?'){
						exp.beginning = true;
						exp.couple = ':';
						brackets.push(exp);
					}
					else if(value === ':'){
						//{i:v,}, change : priority to 0, same with ,
						if(expect === ':'){
							exp.priority = 0;
						}
						else{
							exp.couple = '?';
						}
					}
				}
				else{
					throw 'syntax error: unknown operator ' + value + '\nexpression: ' + this.source;
				}
			}

			//brackets
			else if(args[6]){
				var bindex = this.brackets.indexOf(value),
					couple = this.brackets[this.brackets.length - 1 - bindex];

				exp.type = 'b';
				exp.value = value;
				exp.beginning = bindex < 3;
				exp.couple = couple;

				//[ ( {
				if(exp.beginning){
					//a[], a()
					if(expect === 'o'){
						var o = this.getOperator(value, 'br');
						if(o){
							exp.type = 'o';
							$.apply(exp, o);
						}
					}
					brackets.push(exp);
				}
			}

			//'Number' to Number
			if(prevExp && prevExp.mayKeyWord){
				//if prev may keyword, this is operator, it could only be r or b
				if(exp.type === 'o' && !exp.assign || exp.type === 'b' && !exp.beginning){
					prevExp.type = 'v';
					prevExp.value = this.keywords[prevExp.value];
				}
				delete prevExp.mayKeyWord;
			}

			//brackets match, include ? : match
			if(exp.couple && !exp.beginning){
				var coupExp = brackets.pop();

				if(!coupExp || coupExp.value !== exp.couple){
					throw 'syntax error: missing ' + exp.couple + '\nexpression: ' + this.source;
				}
			}

			//, can be include
			else if(exp.type === 'o' && value === ','){
				var coupExp = brackets.get(-1);

				//if should not contains ,
				if(!(coupExp && (coupExp.priority && coupExp.value === '(' || !coupExp.priority && coupExp.value === '[' || coupExp.value === '{'))){
					throw 'syntax error: ' + value + '\nexpression: ' + this.source;
				}
			}

			var unexpected = false;

			//handle expect
			if(expect === 'v'){
				//a, 1, ++, [, {
				if(exp.type === 'v' || exp.type === 'p'){
					expect = 'o';
				}
				else if(exp.type === 'o' && exp.where === 'l'){
					expect = 'v';
				}
				//[, (, {
				else if(exp.type === 'b' && exp.beginning){
					expect = value === '{' ? 'i' : 'v';
				}
				//[], (), {}, except value but suddenly end
				else if(exp.type === 'b' && prevExp && prevExp.couple === value){
					expect = 'o';
				}
				//,]
				else if(exp.type === 'b' && value === ']' && prevExp && prevExp.type === 'o' && prevExp.value === ','){
					expect = 'o';
				}
				else{
					unexpected = true;
				}
			}

			else if(expect === 'o'){
				if(exp.type === 'o'){
					var coupExp = brackets.get(-1);
					//{, expect i
					if(value === ',' && coupExp && coupExp.value === '{'){
						expect = 'i';
					}
					else{
						expect = exp.where === 'r' ? 'o' : 'v';
					}
				}
				else if(exp.type === 'b' && !exp.beginning){
					expect = 'o';
				}
				//like delete a, new a, not support new (a), which will parsed to xxx.new(a)
				else if((exp.type === 'v' || exp.type === 'p') && prevExp.mayOperator){
					prevExp.type = 'o';
					$.apply(prevExp, this.getOperator(prevExp.value, 'l'));
					expect = 'o';
					delete prevExp.mayOperator;
				}
				else{
					unexpected = true;
				}
			}

			else if(expect === 'i'){
				if(exp.type === 'v' || exp.type === 'p'){
					expect = ':';
				}
				else if(exp.type === 'b' && value === '}'){
					expect = 'o';
				}
				else{
					unexpected = true;
				}
			}

			else if(expect === ':'){
				if(value === ':'){
					expect = 'v';
				}
				else{
					unexpected = true;
				}	
			}

			if(unexpected){
				throw 'syntax error: unexpected ' + value + '\nexpression: ' + this.source;
			}

			exps.push(exp);
			prevExp = exp;

		}).bind(this));
		
		//like String, already end and it should be parsed as String function
		if(prevExp && prevExp.mayKeyWord){
			prevExp.type = 'v';
			prevExp.value = this.keywords[prevExp.value];
			delete prevExp.mayKeyWord;
		}

		if(prevExp && prevExp.mayOperator){
			delete prevExp.mayOperator;
		}

		//remove the last ;
		else if(prevExp && prevExp.type === 'o' && prevExp.value === ';'){
			exps.pop();
		}
		
		else if(exps.length > 0 && expect !== 'o'){
			throw 'syntax error: unterminated end' + '\nexpression: ' + this.source;
		}

		else if(brackets.length > 0){
			throw 'syntax error: missing ' + (brackets.get(-1).couple) + '\nexpression: ' + this.source;
		}

		this.handleVars(exps);

		return exps;
	},

	//a.b -> a.b, a, changing of a or a.b will affect the result
	//support also a['b'], but mark it as a.b
	//support also a['b.c'], but mark it as a.b..c(not implement)
	handleVars : function(exps){
		var prevVar = '',
			prevAssign = false;

		for(var i = 0; i < exps.length; i++){
			var exp = exps[i];

			switch(exp.type){
				case 'v':
					if(prevVar){
						prevVar += '.' + exp.value;
						this.vars.add(prevVar);
					}
					break;

				case 'p':
					prevVar = exp.value;
					this.vars.add(prevVar);
					break;

				case 'o':
					if(prevVar){
						if(exp.value !== '.' && exp.value !== '['){
							this.strictVars.add(prevVar);
							if(prevAssign || exp.assign){
								this.assignVars.add(prevVar);
							}
							prevVar = '';
							prevAssign = false;
						}
					}
					else if(exp.assign){
						prevAssign = true;
					}
					break;

				//case 'b':
					//nothing happens
			}
		}

		if(prevVar){
			this.strictVars.add(prevVar);
			if(prevAssign){
				this.assignVars.add(prevVar);
			}
		}
	},

	//when meet an operator, eat the next expression which will be exec earlier, return them as an array of exps, or array of them
	//a + b * c, pos is position of +, return b * c
	//if start with ?, not eat after :, eat before it
	takeExps : function(exps, pos, isMulty){
		var startExp = exps[pos],
			brackets = [],
			i;

		var args = [];

		//if ? :, eat the expression between ? and :
		if(startExp.couple && startExp.value !== '?'){
			brackets.push(startExp);
		}

		for(i = pos + 1; i < exps.length; i++){
			var exp = exps[i];
			
			//eat the expression before , or :
			if(isMulty && exp.type === 'o' && (exp.value === ',' || exp.value === ':')){
				args.push(exps.splice(pos + 1, i - pos - 1));
				exps.splice(pos + 1, 1);
				i = pos;
			}
			//a * b + c, + is lower than *, if a.b(), end before (), if meet ?, requires : to close it
			//for ?, 1 ? 2 ? 3 : 4 : 5, the second ? has higher priority
			//for a = b = c, calc the second one
			else if(exp.priority <= startExp.priority && !(exp.value === '?' && startExp.value === '?' || exp.assign && startExp.assign) && brackets.length === 0){
				break;
			}
			else if(exp.couple){
				if(exp.beginning){
					brackets.push(exp);
				}
				else{
					brackets.pop();
					////eat the ) ] }, end
					if(brackets.length === 0 && startExp.couple && startExp.couple !== ':'){
						exps.splice(i, 1);
						break;
					}
				}
			}
		}

		if(isMulty && i > pos + 1){
			args.push(exps.splice(pos + 1, i - pos - 1));
		}

		if(isMulty){
			return args;
		}
		else{
			return exps.splice(pos + 1, i - pos - 1);
		}
	},

	//parse exps to attrs. a + 1 -> [+, [a], 1], z = a + b -> [=, z, [+, [a], [b]]]
	parseExpsToArrs : function(exps){
		if(exps.length === 0){
			return undefined;
		}
		else if(exps.length === 1 && exps[0].type === 'v'){
			return exps[0].value;
		}

		var arrs = [''];

		for(var i = 0; i < exps.length; i++){
			var exp = exps[i],
				value = exp.value;

			switch(exp.type){
				case 'v':
					arrs.push(value);
					break;

				case 'p':
					//a -> [., [$], a]
					if(arrs[0]){
						arrs = ['', arrs];
					}
					arrs[0] = '@';
					arrs.push(value);
					break;

				case 'o':
					if(arrs[0]){
						arrs = ['', arrs];
					}

					//++a -> ++?
					if(exp.where === 'l' && (value === '++' || value === '--' || value === '-')){
						arrs[0] = value + '?';
					}
					else if(value === '['){
						arrs[0] = '.';
					}
					else{
						arrs[0] = value;
					}

					//? exp : exp, take two exps
					if(value === '?'){
						arrs.push(this.parseExpsToArrs(this.takeExps(exps, i)));
						i++;	//eat the :
						arrs.push(this.parseExpsToArrs(this.takeExps(exps, i)));
					}
					//is not right operator, eat next expression as a value
					else if(exp.where !== 'r'){
						//like (,), [,], {,} required multy expressions
						var isMulty = value === '(',
							tokenExps = this.takeExps(exps, i, isMulty);

						if(isMulty){
							for(var j in tokenExps){
								arrs.push(this.parseExpsToArrs(tokenExps[j]));
							}
						}
						else{
							arrs.push(this.parseExpsToArrs(tokenExps));

							//new (, remove the (, keep new
							if(value === 'new' && arrs.get(-1)[0] === '('){
								arrs.push.apply(arrs, arrs.pop().slice(1));
							}
						}
					}
					break;

				case 'b':
					if(arrs[0]){
						arrs = ['', arrs];
					}

					arrs[0] = value;

					var isMulty = value === '[' || value === '{',
						tokenExps = this.takeExps(exps, i, isMulty);

					if(isMulty){
						for(var j in tokenExps){
							arrs.push(this.parseExpsToArrs(tokenExps[j]));
						}
					}
					//ignore ()
					else if(value === '('){
						arrs = this.parseExpsToArrs(tokenExps);
					}
					else{
						arrs.push(this.parseExpsToArrs(tokenExps));
					}
					break;
			}
		}

		return arrs;
	},

	//find properties in scopes
	//only suport single expression, not support statement
	//at least one scope must exist
	calc : function(scopes){
		return this.arrs instanceof Array ? this.calcArrs(scopes, this.arrs) : this.arrs;
	},
 	
	calcObject : function(scopes, arrs, operator){
		var a = [];

		for(var i = 1; i < arrs.length; i++){
			a.push(arrs[i] instanceof Array ? this.calcArrs(scopes, arrs[i]) : arrs[i]);
		}

		if(operator === '['){
			return a;
		}
		else{
			var o = {};

			for(var i = 0; i < a.length; i++){
				o[a[i]] = a[i + 1];
				i++;
			}

			return o;
		}
	},

	calcFunction : function(scopes, arrs, operator, scope, property, value1){
		var a = [];

		for(var i = 2; i < arrs.length; i++){
			a.push(arrs[i] instanceof Array ? this.calcArrs(scopes, arrs[i]) : arrs[i]);
		}

		//fn() or String(), if value1, it gets from keywords, always be a function
		if(operator === '('){
			if(scope !== undefined && scope !== null && !(scope[property] instanceof Function)){
				throw property + ' is not a function' + '\nexpression: ' + this.source;
			}
			else if((scope !== undefined && scope !== null ? scope[property] : value1) instanceof Function){
				return (scope !== undefined && scope !== null ? scope[property] : value1).apply(scope, a);
			}
		}
		//new fn(), support at most 4 arguments
		else{
			if(!(value1 instanceof Function)){
				throw String(value1) + ' is not a function' + '\nexpression: ' + this.source;
			}
			switch(a.length){
				case 0:
					return new value1();

				case 1:
					return new value1(a[0]);

				case 2:
					return new value1(a[0], a[1]);

				case 3:
					return new value1(a[0], a[1], a[2]);

				default:
					return new value1(a[0], a[1], a[2], a[3]);
			}
		}
	},

	calcOperator : function(scopes, arrs, operator, scope, property, value1){
		var value2;

		if(!(this.operators[operator].single)){
			value2 = arrs[2] instanceof Array ? this.calcArrs(scopes, arrs[2]) : arrs[2];
		}

		switch(operator){
			case '++':
				return scope[property]++;

			case '--':
				return scope[property]--;

			case '++?':
				return ++scope[property];

			case '--?':
				return --scope[property];

			case '-?':
				return -value1;

			case '~':
				return ~value1;

			case '!':
				return !value1;

			case 'delete':
				return delete scope[property];

			case 'typeof':
				return typeof value1;

			case 'void':
				return undefined;

			case '*':
				return value1 * value2;

			case '/':
				return value1 / value2;

			case '%':
				return value1 % value2;

			case '+':
				return value1 + value2;

			case '-':
				return value1 - value2;

			case '<<':
				return value1 << value2;

			case '>>':
				return value1 >> value2;

			case '>>>':
				return value1 >>> value2;

			case '<':
				return value1 < value2;

			case '<=':
				return value1 <= value2;

			case '>':
				return value1 > value2;

			case '>=':
				return value1 >= value2;
				break;

			case 'in':
				return value1 in value2;

			case 'instanceof':
				return value1 instanceof value2;

			case '==':
				return value1 == value2;

			case '!=':
				return value1 != value2;

			case '===':
				return value1 === value2;

			case '!==':
				return value1 !== value2;

			case '&':
				return value1 & value2;

			case '^':
				return value1 ^ value2;

			case '|':
				return value1 | value2;

			case '&&':
				return value1 && value2;

			case '||':
				return value1 || value2;

			case '?':
				return value1 ? value2 : arrs[3] instanceof Array ? this.calcArrs(scopes, arrs[3]) : arrs[3];

			case '=':
				return scope[property] = value2;

			case '+=':
				return scope[property] += value2;

			case '-=':
				return scope[property] -= value2;

			case '*=':
				return scope[property] *= value2;

			case '/=':
				return scope[property] /= value2;

			case '%=':
				return scope[property] %= value2;

			case '<<=':
				return scope[property] <<= value2;

			case '>>=':
				return scope[property] >>= value2;

			case '>>>=':
				return scope[property] >>>= value2;

			case '&=':
				return scope[property] &= value2;

			case '^=':
				return scope[property] ^= value2;

			case '|=':
				return scope[property] |= value2;

			case ';':
				return value2;
		}
	},

	//if thisIsScope equals true, and operator is . or [@, returns scope and property, not the calced value
	calcArrs : function(scopes, arrs, thisIsScope, thisIsAssign){
		var operator = arrs[0];
		
		//return array or object, end
		if(operator === '[' || operator === '{'){
			return this.calcObject(scopes, arrs);
		}

		var nextIsScope = this.operators[operator].assign || operator === '(' || operator === 'delete',
			nextIsAssign = this.operators[operator].assign || operator === 'delete',
			value1,
			scope,
			property;

		//if prev operator is ++, needs scope to calc
		if(nextIsScope){
			//calc scope and property
			if(arrs[1] instanceof Array){
				var a = this.calcArrs(scopes, arrs[1], nextIsScope, nextIsAssign);
				scope = a[0];
				property = a[1];
			}
			//Numbe or String function, that can not calc scope, and may also 1++ to calc scope[1]++
			else{
				value1 = arrs[1];

				if(typeof value1 === 'string' || typeof value1 === 'number'){
					scope = this.calcScope(scopes, value1, nextIsAssign);
					property = arrs[1];
				}
			}
		}
		else{
			value1 = arrs[1] instanceof Array ? this.calcArrs(scopes, arrs[1], nextIsScope, nextIsAssign) : arrs[1];
		}

		//a() or new a()
		if(operator === '(' || operator === 'new'){
			return this.calcFunction(scopes, arrs, operator, scope, property, value1);
		}

		switch(operator){
			case '.':
				var value2 = arrs[2] instanceof Array ? this.calcArrs(scopes, arrs[2]) : arrs[2];

				//remember the self and property for function calling and delete
				return thisIsScope ? [value1, value2] : value1 ? value1[value2] : undefined;

			case '@':
				return thisIsScope ? [this.calcScope(scopes, value1, thisIsAssign), value1] : this.calcValue(scopes, value1);

			default:
				return this.calcOperator(scopes, arrs, operator, scope, property, value1);
		}
	},

	//cacl [@, value]
	calcValue : function(scopes, value){
		if(scopes){
			for(var i in scopes){
				var scope = scopes[i];

				if(value in scope){
					return scope[value];
				}
			}
		}

		return undefined;
	},

	//calc like [@, value]++, firstly calc scope by this function, then call scope[value]++
	calcScope : function(scopes, value, isAssign){
		if(this.isLet && isAssign){
			if(scopes){
				for(var i in scopes){
					var scope = scopes[i];

					if(scope.__proto__ !== $.Lexer.tempScope){
						return scope;
					}
				}
			}
			
			return null;
		}

		else if(scopes){
			for(var i in scopes){
				var scope = scopes[i];

				if((value in scope) && (!isAssign || scope.__proto__ !== $.Lexer.tempScope)){
					return scope;
				}
			}

			for(var i in scopes){
				var scope = scopes[i];

				if(!isAssign || scope.__proto__ !== $.Lexer.tempScope){
					return scope;
				}
			}
		}

		else{
			return null;
		}
	}
});


//as __proto__ to mark an scope to readonly
$.Lexer.tempScope = {},




/*
	bind an json to and element, we would not suggest to bind a closure which have binded by other closure
	if you want, bind global scope to nodes which have existed, and new closure to newly create

	when do binding or bind event handlers, please mark the variables which will be assigned
	when set attributes, please mark the variables which will affect the attribute value
	
	variables in binded scope
		clo: point to closure, only for the closure that bind to $scope element

	variables in el:
		$closure: this

	variables in this:
		dirty: any appearance data has changed, when newly load data, it is set to false
		scope: the binded json object
		scopes: [let scope, scope, global scope]
		letScope: the variables that create by $let, or $loop
		parent: parent closure

	variables in expression of $attribute or {{xxx}}:
		this: this
		index: for $list
		value: for $bind and $format, $list, like $bind="v" $format="Number(value)"
		event: for event handler like $click="handler(event)"
		global variables which binded like $scope="name"

	about auto refresh:
		like $visible="a&&b", if another place bind to a, and it's value change, or call refresh('a'), it will be automaticially refresh
		caution: the variables created by $let or only for $loop like $index, index and value will not auto refresh!
		every time refresh any vars, refresh this
		child closure can't refresh parent closure, but can refresh it's child closures
		only 'this' variable will be bubbled

	html tags:
		$readonly: expression
		$hidden: expression
		$visible: - hidden
		$disabled: expression
		$value: get value, expression, for radio or checkbox, it's the checked value
			$true: an expression to return the true value. only for checked or radio. if value is not this value but boolean type, take the value too
			$false:
			$trueValue: like above, but specify the string
			$falseValue
		$text: like above, expression
			$count: format the $text or textContent by this count, {#} persion{s|} {are|is}...see $.msg.buildCount, affect child and grandchild
		$html: like above, but not encodeHTML, expression
			$count
		$class: expression, will add original class before it
		$style: expression
		$href:
		$src:
	
	control tags:
		$scope: bind an scope to current node and the global json object
			for global scope, do not load new json data, you can use apply or property to store data
		$skip: ship this tag, not test all the child nodes in it and itself
		$let: create variables in current scope, which will not apply to json, support ; to split multiple assignments
			default handled before json data binded, can not ask scope, and will not refresh after scope reloading
			if bind to $loop element, auto refresh when refreshing loops and need to refresh
		$name: create a small part, can be refresh by $fresh, ignore scope, not work for $loop closores
		$bind: bind one json property to an element like input, once it's value changes, change the property binded to json
			$format: function or an expression to format input value
		$bindarray: for checkbox, push $true value to array if checked
		{{expression}}: in text node to replace the content to lexer, and calc it by json
			$count: format by $.msg.buildCount
		$if: like $hidden, but will remove element if need
		$switch: if $case of child is false, remove this child
		$case: string, use ==
		$loop="i, v in a | v of a | i in a | i = 1 to 10": if loop an arraycreate a anonymous scope, inherit outside scope
			variables: $index, $count, $first, $last, $key, $value
			do not add __proto__ to the json that will be enum, or the prototype properties will be enumed
			$sort: set the sort function or expression for $list or $loop, if is empty, take original value to sort.
				can be an expression which returns a function, like $loop="v of object" $sort="Number"
				can be an expression to return a value to sort, like $loop="v of object" $sort="Number(v)"
				if has - in front, sort in reverse
			$filter: set filter function for $list or $loop
				can be an expression which specify a string, the value or sub properties of value which contain or equals it will be selected
					like input $bind="q" $loop="v of object" $filter="q"
				can be an expression which returns a function, this function get value and index, and returns true to select
				can be an expression which returns a boolean value, like $loop="v of object" $filter="v.contains('123')"
			$key: create a key by this lexer
		$list: for drop or select, [[]] or [], or {}
			$sort: like $sort for $loop
			$filter:
			$format
			
	events:
		$click
		$mousedown
		$mouseup
		$mouseover
		$mouseout
		$mousemove
		$mouseenter
		$mouseleave
		$mousewheel, up, down
		$keyup
		$keydown
		$press
		$change
		$focus
		$scroll
		$blur
		$cut
		$copy
		$paste
		$enter
*/
$.Closure = $({
	keywords : {
		attrs : {
			//@xxx to setAttribute or removeAttribute, -to get the reversed value, -?@?property
			disabled	: '@disabled',
			enabled		: '-@disabled',
			readonly	: '@readonly',
			editable	: '@contenteditable',
			id			: 'id',
			for			: 'htmlFor',
			name		: 'name',
			href		: 'href',
			src			: 'src',
			hidden		: '@hidden',
			visible		: '-@hidden',
			//radio and checkbox use the value property, and support $true and $false
			value		: 'value',
			//if value is omit, can used as value
			bind 		: 'value',
			bindarray	: 'value',
			text		: 'textContent',
			html		: 'innerHTML',
			class		: 'className',
			style		: 'style'
		},

		control : {
			let			: true,
			bind		: true,
			bindarray	: true,
			if			: true,
			//'switch'	: true,
			case		: true
		},

		events : {
			click		: true,
			dblclick	: true,
			check		: true,
			uncheck		: true,
			mousedown	: true,
			mouseup		: true,
			mouseover	: true,
			mouseout	: true,
			mousemove	: true,
			mouseenter	: true,
			mouseleave	: true,
			mousewheel	: true,
			mousewheelup	: true,
			mousewheeldown	: true,
			keyup		: true,
			keydown		: true,
			press		: true,
			input		: true,
			change		: true,
			focus		: true,
			scroll		: true,
			blur		: true,
			cut			: true,
			copy		: true,
			paste		: true,
			enter 		: true
		},

		classes : {
			//the class should has update method to update data, and has the binded method and event to update value from instance, and trigger the event
			//if has the attribute equals the update arguments + value, parse it as value, not lexer
			//if list, parse sort and filter for it, and $list must be the first argument of update array
			//cfg is the config lexer that will be applied to instance, only once
			//tip :  {class : $.Tip, cfg : [], update : ['$tip'], cfg : {cfg1 : cfg1, cfg2 : true}};	//update is arguments for update, cfg is arguments for class, true to set value as index
			//list :  {class : $.Drop, cfg : [], update : ['$list'], bind : 'select', events : {select : ['value']}};
		},

		//run once
		plugins : {
			//tabable : {init : .., onClick : ...}
		}
	},

	dirty : false,

	els : null,

	//the input that are inputing, or the class that trigger changing of the binded value
	lockedInput : null,

	//lock the dirty to false when refreshing
	lockDirty : false,

	//parent only for loop templete
	init : function(els, parentClosureOrScope){
		this.attrs  	= [];	//attribute array
		this.ifs    	= [];	//if array
		this.classes	= [];	//class array
		this.loops  	= [];	//loop array
		this.events 	= [];	//event array
		this.plugins	= [];	//plugin array
		this.vars		= {};	//variable object, {var : {attrs : [], ifs : [], loops : [], classes : [], bubbledLoops : []}}
		this.lets		= [];	//all $let lexers
		this.letScope	= {this : this};

		if(parentClosureOrScope instanceof $.Closure){
			this.top = parentClosureOrScope.top;
			this.parent = parentClosureOrScope;
			this.scopes = [this.letScope].concat(parentClosureOrScope.scopes);
		}
		//bind method still need the scope to calc the configs for instance
		else if(parentClosureOrScope){
			this.top = this;
			this.scope = parentClosureOrScope;
			this.scopes = [this.letScope, this.scope, $.Closure.scopes];
		}
		else{
			this.top = this;
			this.scopes = [this.letScope, $.Closure.scopes];
		}

		if(els){
			this.bind(els);
		}

		if(els && this.scope){
			this.reload();
		}
	},

	//clone the el and scopes, and also attrs, ifs, lets, loops, classes, and replace the node property, bind events
	//the templete closure should not load scope
	//first argument can be parent closure and scope
	clone : function(parentClosureOrScope){
		var closure = new $.Closure(null, parentClosureOrScope);

		//clone binded els
		closure.els = [];

		for(var i in this.els){
			closure.els[i] = this.els[i].cloneNode(true);
			closure.els[i].$closure = closure;
		}

		closure.lets = this.lets;
		closure.vars = this.vars;
		closure.staticVars = this.staticVars;
		closure.loopCommentNode = this.loopCommentNode

		//clone binded attrs
		var ps = ['attrs', 'ifs', 'loops', 'classes'];

		//node, commentNode(ifs or loops), closures(ifs) can't be shared
		for(var i in ps){
			var p = ps[i];

			for(var j in this[p]){
				var o = this[p][j],
					pos = o.pos,
					node = closure.els[pos[0]],
					clonedO = $.inherit({}, o);

				for(var k = 1; k < pos.length; k++){
					node = node.childNodes[pos[k]];
				}

				//loops templete, the comment node in el, and original node was removed
				clonedO[p === 'loops' ? 'commentNode' : 'node'] = node;

				//if templete, original node in el, but need to copy a comment node for replacing
				if(p === 'ifs'){
					clonedO.commentNode = o.commentNode.cloneNode(true);
				}

				else if(p === 'loops'){
					clonedO.closures = [];
					clonedO.closuresByKey = {};
				}

				closure[p].push(clonedO);
			}
		}

		for(var j in this.events){
			var o = this.events[j],
				pos = o.pos,
				node = closure.els[pos[0]];

			for(var k = 1; k < pos.length; k++){
				node = node.childNodes[pos[k]];
			}

			node.on(o.name, o.handler, closure);
		}

		for(var j in this.plugins){
			var o = this.plugins[j],
				pos = o.pos,
				node = closure.els[pos[0]];

			for(var k = 1; k < pos.length; k++){
				node = node.childNodes[pos[k]];
			}

			o.plugin.init(node);
		}

		if(closure.scope){
			closure.reload();
		}

		return closure;
	},

	//bind to an element, not refresh
	bind : function(els){
		if(typeof els === 'string'){
			els = document.create(els);
		}
		else if(els instanceof Node){
			els = [els];
		}

		this.els = els;

		for(var i in els){
			this.handleEl(els[i]);
		}
	},

	handleEl : function(el){
		el.$closure = this;

		var els = el.queryAll('*');

		els.unshift(el);

		for(var i = 0; i < els.length; i++){
			var node = els[i];

			if(node.hasAttribute('$skip') || node.hasAttribute('$scope') && !this.els.contains(node)){
				while(els[i + 1] && node.contains(els[i + 1])){
					i++;
				}
				continue;
			}

			//handle loop, and skip all the node in or equals it
			if(node.hasAttribute('$loop')){
				while(els[i + 1] && node.contains(els[i + 1])){
					i++;
				}
				this.handleLoop(node, node.getAttribute('$loop'));
				continue;
			}

			//handle classes, before handle attributes. may shift $handler, $value
			var bindAction = '';

			for(var name in this.keywords.classes){
				if(node.hasAttribute('$' + name) || node.hasAttribute('$' + name + 'value')){
					var clsCfg = this.filterClass(node, name);
					if(clsCfg){
						this.handleClass(node, name, clsCfg);
						bindAction = clsCfg.bind;
					}
				}
			}

			var atts = node.attributes,
				eventAttrs = [];

			for(var j = 0; j < atts.length; j++){
				var att = atts[j];

				if(att.localName[0] === '$'){
					var name = att.localName.slice(1);

					if(name in this.keywords.attrs){
						//has bind and has value, skip bind, only handle value; and if bindAction, not handle bind and value
						if(!(name === 'bind' && node.hasAttribute('$value')) && !(bindAction && (name === 'bind' || name === 'value'))){
							this.handleAttr(node, name, att.value);
						}
					}

					//bind work for both attrs and control
					if(name in this.keywords.control){
						switch(name){
							case 'let':
								this.handleLets(node, att.value);
								break;

							case 'bind':
								if(!bindAction){
									this.handleBind(node, att.value);
								}
								break;

							case 'bindarray':
								if(!bindAction){
									this.handleBindArray(node, att.value);
								}
								break;

							case 'if':
								this.handleIf(node, att.value);
								break;

							case 'case':
								this.handleIf(node, att.value + '==' + node.parentNode.getAttribute('$switch'));
								break;
						}
					}

					//we must make sure events been handled after binding handled
					else if(name in this.keywords.events){
						eventAttrs.push({name : name, text : att.value});
					}

					else if(name in this.keywords.plugins){
						this.handlePlugins(node, name, att.value);
					}
				}
			}

			for(var j in eventAttrs){
				this.handleEvents(node, eventAttrs[j].name, eventAttrs[j].text);
			}

			this.handleTextChildren(node);
		}

		this.handleNodePosition();
		this.handleVars();
	},

	//will refresh after load, refresh lets before refresh
	load : function(scope){
		if(this.scope){
			this.scopes.remove(this.scope);
		}

		if(scope){
			this.scopes.push(scope);
			this.scope = scope;
			this.refreshLets();
			this.lockDirty = true;
			this.refresh();
			this.lockDirty = false;
		}
	},

	//refresh but lockDirty
	reload : function(){
		this.lockDirty = true;
		this.refresh();
		this.lockDirty = false;
	},

	handleAttr : function(node, name, text){
		var att = {
			node : node,
			name : name,
			lexer : new $.Lexer(text),
			lastValue : undefined,
			property : this.keywords.attrs[name]
		};

		if(att.property[0] === '-'){
			att.isReverse = true;
			att.property = att.property.slice(1);
		}

		if(att.property[0] === '@'){
			att.isAttribute = true;
			att.property = att.property.slice(1);
		}

		if(att.property === 'value'){
			if(node.is('input[type=checkbox], input[type=radio]')){
				att.property = 'checked';
				att.isBool = true;
				att.trueLexer = this.getBooleanLexer(node, true);
				if(node.is('input[type=checkbox]')){
					att.falseLexer = this.getBooleanLexer(node, false);
				}
			}
			else if(!node.is('input, select, textarea')){
				att.property = 'innerHTML';
			}
		}

		//if get html or text from lexer, count bind to attrs, not texts
		if(name === 'text' || name === 'html'){
			att.startValue = node[att.property];
			att.countLexer = node.hasAttribute('$count') ? new $.Lexer(node.getAttribute('$count')) : null;
		}

		else if(name === 'class'){
			att.startValue = node.className.trim();
			att.startValue = att.startValue ? att.startValue + ' ' : att.startValue;
		}

		else if(name === 'style'){
			att.startValue = node.style.cssText.replace(/[;\s]*$/, '').trim();
			att.startValue = att.startValue ? att.startValue + '; ' : att.startValue;
		}

		this.attrs.push(att);
	},

	getBooleanLexer : function(node, bool){
		bool = String(bool);

		var lexerValue = node.getAttribute('$' + bool);

		if(lexerValue){
			return new $.Lexer(lexerValue);
		}
		else if(node.hasAttribute('$' + bool + 'Value')){
			return new $.Lexer("'" + String.jsEncode(node.getAttribute('$' + bool + 'Value'), "'") + "'");
		}
		else{
			return new $.Lexer(bool);
		}
	},

	parseTextToLexer : function(text){
		var lastIndex = 0,
			a = [];

		text.replace(/\{\{(.+?)\}\}/g, (function($0, $1, index){
			if(index > lastIndex){
				a.push("'" + String.jsEncode(text.slice(lastIndex, index), "'") + "'");
			}
			a.push('(' + $1 + ')');
			lastIndex = index + $0.length;
		}).bind(this));

		if(lastIndex < text.length){
			a.push("'" + String.jsEncode(text.slice(lastIndex), "'") + "'");
		}

		return new $.Lexer(a.join('+'));
	},

	handleTextChildren : function(node){
		var textEls = node.childNodes;

		for(var j in textEls){
			var textNode = textEls[j];

			if(textNode.nodeType === 3){
				this.handleTextNode(node, textNode);
			}
		}
	},

	handleTextNode : function(node, textNode){
		var text = textNode.textContent,
			parent = node,
			countValue;

		countValue = parent.hasAttribute('$count') && !parent.hasAttribute('$text') && !parent.hasAttribute('$html') ? parent.getAttribute('$count') : '';

		if(!countValue){
			parent = parent.parentNode;
			if(parent){
				countValue = parent.hasAttribute('$count') && !parent.hasAttribute('$text') && !parent.hasAttribute('$html') ? parent.getAttribute('$count') : '';
			}
		}

		if(/\{\{.+?\}\}/.test(text)){
			this.attrs.push({
				node : textNode,
				lexer : this.parseTextToLexer(text),
				property : 'textContent',
				startValue : text,
				lastValue : undefined,
				countLexer : countValue ? new $.Lexer(countValue) : null
			});
		}

		else if(countValue){
			this.attrs.push({
				node : textNode,
				property : 'textContent',
				startValue : text,
				countLexer : new $.Lexer(countValue)
			});
		}
	},

	handleLets : function(node, lets){
		if(lets){
			var lexer = new $.Lexer(lets);
			this.lets.push(lexer);
		}
	},

	tempScopes : function(scope){
		scope = $.inherit(scope, $.Lexer.tempScope);

		return [scope].concat(this.scopes);
	},

	handleBind : function(node, text){
		var assignLexer = new $.Lexer(text + '=value'),
			bindedVar = assignLexer.strictVars.get(-2),
			name = 'change',
			handler;

		if(node.is('input[type=checkbox]')){
			var trueLexer = this.getBooleanLexer(node, true),
				falseLexer = this.getBooleanLexer(node, false);

			handler = function(e){
				assignLexer.calc(this.tempScopes({value : e.target.checked ? trueLexer.calc(this.scopes) : falseLexer.calc(this.scopes), event : e}));

				if(!this.lockDirty){
					this.makeDirty();
				}

				this.lockedInput = e.target;
				this.top.refresh(bindedVar);
				this.lockedInput = null;
			};
		}

		else if(node.is('input[type=radio]')){
			var trueLexer = this.getBooleanLexer(node, true);

			handler = function(e){
				assignLexer.calc(this.tempScopes({value : trueLexer.calc(this.scopes), event : e}));

				if(!this.lockDirty){
					this.makeDirty();
				}

				this.lockedInput = e.target;
				this.top.refresh(bindedVar);
				this.lockedInput = null;
			};
		}

		else{
			var formatValue = node.getAttribute('$format'),
				formatLexer = formatValue ? new $.Lexer(formatValue) : null;

			name = 'input';
			handler = function(e){
				if(!e.target.willValidate || e.target.validity.valid){
					var value = e.target.is('input, select, textarea') ? e.target.value : e.target.innerHTML,
						tempScopes = this.tempScopes({value : value, event : e});

					if(formatLexer){
						var formatedValue = formatLexer.calc(tempScopes);
						if(formatedValue instanceof Function){
							formatedValue = formatedValue.call(this.scope, value);
						}
						tempScopes[0].value = formatedValue;
					}

					assignLexer.calc(tempScopes);

					if(!this.lockDirty){
						this.makeDirty();
					}

					this.lockedInput = e.target;
					this.top.refresh(bindedVar);
					this.lockedInput = null;
				}
			};
		}

		node.on(name, handler, this);

		this.events.push({
			node : node,
			name : name,
			handler : handler
		});
	},

	handleBindArray : function(node, text){
		var arrayLexer = new $.Lexer(text),
			bindedVar = arrayLexer.strictVars.get(-1),
			name = 'change',
			handler;

		var trueLexer = this.getBooleanLexer(node, true);

		handler = function(e){
			var trueValue = trueLexer.calc(this.scopes),
				array = arrayLexer.calc(this.scopes);

			if(array instanceof Array){
				e.target.checked ? array.add(trueValue) : array.remove(trueValue);

				if(!this.lockDirty){
					this.makeDirty();
				}

				this.lockedInput = e.target;
				this.top.refresh(bindedVar);
				this.lockedInput = null;
			}
		};

		node.on(name, handler, this);

		this.events.push({
			node : node,
			name : name,
			handler : handler
		});
	},

	handleIf : function(node, text){
		this.ifs.push({
			node : node,
			commentNode : document.createComment('if ' + text),
			lastValue : true,
			lexer : new $.Lexer(text)
		});
	},

	//loop the node iteself
	handleLoop : function(node, text){
		var loopMatch  = text.trim().select(/^([a-z_$]\w*)(?:\s*,\s*([a-z_$]\w*))?\s+in\s+(.+?)$|^([a-z_$]\w*)\s+of\s+(.+?)$|([a-z_$]\w*)\s*=(.+?)\s+to\s+(.+?)$/i);

		if(loopMatch.length === 0){
			throw 'syntax error: invalid loop ' + text;
		}

		var	loopIndex = loopMatch[0],
			loopValue = loopMatch[1] || loopMatch[3] || loopMatch[5],
			loopAtValue = loopMatch[2] || loopMatch[4],
			loopStartValue = loopMatch[6],
			loopEndValue = loopMatch[7],
			loopLetsValue  = node.getAttribute('$let'),
			loopKeyValue = node.getAttribute('$key'),
			commentNode = document.createComment('loop ' + text),	//loop node will be inserted before it
			templeteClosure = new $.Closure(null, this),
			staticVars = $.inherit({}, this.staticVars);

		node.removeAttribute('$loop');
		node.before(commentNode);
		node.remove();

		if(loopIndex){
			staticVars[loopIndex] = true;
		}

		if(loopValue){
			staticVars[loopValue] = true;
		}

		templeteClosure.staticVars = staticVars;
		templeteClosure.loopCommentNode = commentNode
		templeteClosure.bind(node);

		var loop = {
			node : node,
			templeteClosure : templeteClosure,
			commentNode : commentNode,
			loopIndex : loopIndex,
			loopValue : loopValue,
			loopLexer : loopAtValue ? new $.Lexer(loopAtValue) : null,
			loopStartLexer : loopStartValue ? new $.Lexer(loopStartValue) : null,
			loopEndLexer : loopEndValue ? new $.Lexer(loopEndValue) : null,
			loopLetsLexer : loopLetsValue ? new $.Lexer(loopLetsValue, true) : null,
			closures : [],
			loopKeyLexer : loopKeyValue ? new $.Lexer(loopKeyValue, true) : null,
			closuresByKey : {}
		};

		$.apply(loop, this.parseFilter(node));
		$.apply(loop, this.parseSort(node));

		this.loops.push(loop);
	},

	//for $loop and $list
	parseFilter : function(node){
		var filterText = node.getAttribute('$filter'),
			filterLexer = filterText ? new $.Lexer(filterText) : null;

		return {
			willFilter : Boolean(filterLexer),
			filterLexer : filterLexer
		};
	},

	parseSort : function(node){
		var willSort = node.hasAttribute('$sort'),
			sortText = (node.getAttribute('$sort') || '').trim(),
			sortDESC = sortText.startsWith('-'),
			sortLexer = null;

		if(sortDESC){
			sortText = sortText.slice(1);
		}

		if(sortText){
			sortLexer = new $.Lexer(sortText);
		}

		return {
			willSort : willSort,
			sortDESC : sortDESC,
			sortLexer : sortLexer
		};
	},

	filterClass : function(node, name){
		var classes = this.keywords.classes[name];

		if(classes instanceof Array){
			for(var i in classes){
				if(node.hasClass(classes[i].css)){
					return classes[i];
				}
			}
		}
		else{
			return classes;
		}
	},

	getClassConfig : function(node, cfgO){
		var cfg = {el : node};

		if(cfgO){
			for(var i in cfgO){
				var cfgAttr = '$' + i.toLowerCase(),
					cfgName = cfgO[i] === true ? i : cfgO[i];

				var attr = node.getAttribute(cfgAttr);

				if(attr){
					cfg[cfgName] = new $.Lexer(attr).calc(this.scopes);
				}
				else if(node.hasAttribute(cfgAttr + 'value')){
					cfg[cfgName] = node.getAttribute(cfgAttr + 'value');
				}
			}
		}

		return cfg;
	},

	handleClass : function(node, name, clsCfg){
		var theClass = clsCfg.class,
			bindAction = clsCfg.bind;

		if(theClass instanceof Function){
			var cfg = this.getClassConfig(node, clsCfg.cfg),
				lexer = null,
				handler = null,
				events = {},
				argLexers = [];

			if(bindAction){
				var lexerValue = node.getAttribute('$value') || node.getAttribute('$bind');

				if(lexerValue){
					lexer = new $.Lexer(lexerValue);
				}

				var assignLexerValue = node.getAttribute('$bind');

				if(assignLexerValue){
					var assignLexer = assignLexerValue ? new $.Lexer(assignLexerValue + '=value') : null,
						bindedVar = assignLexer ? assignLexer.strictVars.get(-2) : '',
						formatValue = node.getAttribute('$format'),
						formatLexer = formatValue ? new $.Lexer(formatValue) : null;

					//called when the instance trigger the bindAction event
					handler = function(value){
						var tempScopes = this.tempScopes({value : value});

						if(formatLexer){
							var formatedValue = formatLexer.calc(tempScopes);
							if(formatedValue instanceof Function){
								formatedValue = formatedValue.call(this.scope, value);
							}
							tempScopes[0].value = formatedValue;
						}

						if(assignLexer){
							assignLexer.calc(tempScopes);
							this.lockedInput = this;
							this.top.refresh(bindedVar);
							this.lockedInput = null;
						}
					};
				}
			}

			if(clsCfg.events){
				for(var eventName in clsCfg.events){
					if(node.hasAttribute('$' + eventName)){
						this.handleClassEvents(node, eventName, clsCfg.events[eventName], events);
					}
				}
			}

			if(clsCfg.update){

				for(var i in clsCfg.update){
					var up = clsCfg.update[i]

					if(up.contains('@')){
						var trs = node.queryAll(up.before('@'))
						var att = up.after('@')
						for(var j in trs){
							var lexerValue = trs[j].getAttribute(att)
							if(lexerValue){
								lexerValue = lexerValue.replace(/^.+?(in|of)\s+/, '')
								argLexers[i] = new $.Lexer(lexerValue)
								break
							}
						}
					}

					else{
						var argName = '$' + clsCfg.update[i];

						if(node.getAttribute(argName)){
							argLexers[i] = new $.Lexer(node.getAttribute(argName));
						}
						else if(node.hasAttribute(argName + 'value')){
							argLexers[i] = node.getAttribute(argName + 'value');
						}
						else{
							argLexers[i] = undefined;
						}
					}
				}
			}

			var cls = {
				node : node,
				name : name,
				class : theClass,
				cfg : cfg,
				instance : null,
				lexer : lexer,
				bind : bindAction,
				handler : handler,
				events : events,
				argLexers : argLexers
			};

			if(name === 'list'){
				cls.loopIndex = 'index';
				cls.loopValue = 'value';
				$.apply(cls, this.parseFilter(node));
				$.apply(cls, this.parseSort(node));
			}

			this.classes.push(cls);
		}
	},

	handleClassEvents : function(node, eventName, eventArgs, events){
		var eventLexer = new $.Lexer(node.getAttribute('$' + eventName));

		eventArgs = eventArgs || [];

		var eventHandler = function(){
			var tempScope = {};

			for(var i in eventArgs){
				tempScope[eventArgs[i]] = arguments[i];
			}

			eventLexer.calc(this.tempScopes(tempScope));
		}

		events[eventName] = eventHandler;
	},

	newInstance : function(cls){
		var instance = cls.instance = new cls.class($.applyIf({el : cls.node}, cls.cfg));

		if(cls.bind && cls.handler){
			instance.on(cls.bind, cls.handler, this);
		}

		for(var eventName in cls.events){
			instance.on(eventName, cls.events[eventName], this);
		}
					
		return instance;
	},

	handleEvents : function(node, name, text){
		var lexer = new $.Lexer(text),
			bindedVars = lexer.assignVars;

		function handler(e){
			lexer.calc([{event : e}].concat(this.scopes));
			
			if(bindedVars.length > 0){
				this.top.refresh.apply(this.top, bindedVars);
			}
		};

		this.events.push({
			node : node,
			name : name,
			handler : handler
		});

		node.on(name, handler, this);
	},

	handlePlugins : function(node, name, text){
		var plugin = this.keywords.plugins[name];

		this.plugins.push({
			node : node,
			plugin : plugin
		});

		plugin.init(node);
	},

	//calc the position of each node to make sure we can clone the el and replace the node that with the same position, and same event
	//first of the position is the index in this.els
	handleNodePosition : function(){
		var ps = ['attrs', 'ifs', 'loops', 'classes', 'events', 'plugins'];

		for(var i in ps){
			var p = ps[i];

			for(var j in this[p]){
				var o = this[p][j],
					node = p === 'loops' ? o.commentNode : o.node,
					pos = [];

				while(node){
					var index = this.els.indexOf(node);

					if(index > -1){
						pos.unshift(index);
						break;
					}

					pos.unshift(node.nodeIndex(true));
					node = node.parentNode;
				}

				o.pos = pos;
			}
		}
	},

	lexerPros : {
		attrs : ['lexer', 'countLexer', 'trueLexer', 'falseLexer'],
		ifs : ['lexer'],
		//not contains 'loopKeyLexer' and 'loopLetsLexer', they should be stable
		loops : ['loopLexer', 'loopStartLexer', 'loopEndLexer', 'filterLexer', 'sortLexer'],
		classes : ['lexer', 'argLexers', 'filterLexer', 'sortLexer']
	},

	//{var : {attrs : []}}, get all the variables in current closure, exclude loop variables
	handleVars : function(){
		for(var p in this.lexerPros){
			var lexerPros = this.lexerPros[p];

			for(var i = 0; i < this[p].length; i++){
				var o = this[p][i];	//o is {lexer : xxx}

				for(var j in lexerPros){
					var lexerPro = lexerPros[j];

					if(o[lexerPro] instanceof Array){
						for(var k in o[lexerPro]){
							if(o[lexerPro][k]){
								this.handleVarsForLexer(p, i, o, o[lexerPro][k]);
							}
						}
					}
					else if(o[lexerPro]){
						this.handleVarsForLexer(p, i, o, o[lexerPro]);
					}
				}
			}
		}

		this.bubbleVars();
	},

	//o is {lexer : xxx}, p is 'attrs' or 'loops', will exclude all the vars in staticVars
	handleVarsForLexer : function(p, index, o, lexer){
		var vars = lexer.vars;

		for(var j in vars){
			var v = vars[j];

			if(!(v.before('.', true) in this.staticVars)){
				var theVar = this.vars[v] = this.vars[v] || {};

				theVar[p] = theVar[p] || [];
				theVar[p].add(index);

				if(p === 'loops' && theVar.bubbledLoops){
					theVar.bubbledLoops.remove(index);
				}
			}
		}
	},

	//notify parent to refresh this loop for the vars in it. call after bind, in handleLoop
	//when call this, templete closure has not been pushed to parent.loops, and parent.loops has not been fully filled
	bubbleVars : function(){
		var templete = this;

		while(templete.parent){
			var parentVars = templete.parent.vars,
				index = templete.parent.loops.length;

			for(var i in this.vars){
				var parentVar = parentVars[i];

				//not bubble this
				if(i.before('.', true) === 'this' || parentVar && parentVar.loops && parentVar.loops.contains(index)){
					continue;
				}

				if(!parentVar){
					parentVar = parentVars[i] = {};
				}

				parentVar.bubbledLoops = parentVar.bubbledLoops || [];
				parentVar.bubbledLoops.add(index);
			}
			
			templete = templete.parent;
		}
	},

	//arguments can be the variables that marked to be changed
	//when refresh vars, always refresh this
	refresh : function(){
		var o = this,
			vars = $.array(arguments),
			dirty = false;

		if(vars.length > 0){
			o = this.getObjectsByVars(vars);
		}

		if(o.attrs && o.attrs.length > 0){
			dirty = this.refreshAttrs(o.attrs) || dirty;
		}

		if(o.ifs && o.ifs.length > 0){
			dirty = this.refreshIfs(o.ifs) || dirty;
		}

		if(o.loops && o.loops.length > 0){
			dirty = this.refreshLoops(o.loops) || dirty;
		}

		if(o.classes && o.classes.length > 0){
			dirty = this.refreshClasses(o.classes) || dirty;
		}

		if(o.bubbledLoops && o.bubbledLoops.length > 0){
			dirty = this.refreshLoops(o.bubbledLoops, vars) || dirty;
		}

		return dirty;
	},

	//refresh all the vars, and this
	getObjectsByVars : function(vars){
		vars = vars.concat(['this']);

		var os = {};	//{attrs : {}, loops : {}}

		for(var i in vars){
			var v = vars[i];

			if(v in this.vars){
				var indexs = this.vars[v];	//{attrs : [0,1,2]}

				for(var p in indexs){
					var indexArray = indexs[p];

					os[p] = os[p] || [];

					for(var j in indexs[p]){
						var index = indexArray[j],
							realp = p === 'bubbledLoops' ? 'loops' : p;

						os[p].add(this[realp][index]);
					}
				}
			}
		}

		return os;
	},

	refreshLets : function(){
		for(var i in this.lets){
			this.lets[i].calc(this.scopes);
		}
	},

	makeDirty : function(){
		var closure = this;

		while(closure){
			closure.dirty = true;
			closure = closure.parent;
		}
	},

	makeClean : function(){
		this.dirty = false;

		for(var i in this.loops){
			for(var j in this.loops[i].closures){
				this.loops[i].closures[j].makeClean();
			}
		}
	},

	refreshAttrs : function(attrs){
		var dirty = false;

		for(var i in attrs){
			var att = attrs[i],
				value = att.lexer ? att.lexer.calc(this.scopes) : att.startValue,
				countValue = att.countLexer ? att.countLexer.calc(this.scopes) : undefined;

			if((att.name === 'class' || att.name === 'style') && att.startValue){
				value = att.startValue + value;
			}

			//for text content, take empty string when undefined or null
			if((value === undefined || value === null) && (att.property === 'textContent' || att.property === 'innerHTML' || att.property === 'value')){
				value = '';
			}

			if(value !== att.lastValue || countValue !== att.lastCountValue){
				att.lastValue = value;
				att.lastCountValue = countValue;

				//try to reset value by trueValue or falseValue
				if(att.isBool){
					if(att.name === 'bindarray'){
						value = value instanceof Array ? value.contains(att.trueLexer.calc(this.scopes)) : false;
					}
					if(att.trueLexer && att.trueLexer.calc(this.scopes) == value){
						value = true;
					}
					else if(att.falseLexer && att.falseLexer.calc(this.scopes) == value){
						value = false;
					}
					else{
						value = typeof value === 'boolean' ? value : false;
					}
				}

				if(att.isAttribute){
					if(value && !att.isReverse || !value && att.isReverse){
						att.node.setAttribute(att.property, '');
					}
					else{
						att.node.removeAttribute(att.property);
					}
				}
				else if(att.name === 'style'){
					att.node.style.cssText = value;
				}
				else{
					if(att.countLexer){
						value = $.msg.buildCount(value, att.countLexer.calc(this.scopes));
					}

					if(!this.lockedInput || this.lockedInput !== att.node && this.lockedInput !== att.instance){
						try{
							att.node[att.property] = att.isReverse ? !value : value;
						}
						catch(e){}
					}
				}

				dirty = true;
			}
		}

		if(dirty && !this.lockDirty){
			this.makeDirty();
		}

		return dirty;
	},

	refreshIfs : function(ifs){
		var dirty = false;

		for(var i in ifs){
			var theif = ifs[i],
				value = theif.lexer.calc(this.scopes);

			if(value !== theif.lastValue){
				theif.lastValue = value;

				var node = theif.node,
					commentNode = theif.commentNode;

				if(value){
					commentNode.parentNode.replaceChild(node, commentNode);
				}
				else{
					node.parentNode.replaceChild(commentNode, node);
				}
			}
		}

		if(dirty && !this.lockDirty){
			this.makeDirty();
		}

		return dirty;
	},

	doFilter : function(loopObject, loop){
		var loopIndex = loop.loopIndex,
			loopValue = loop.loopValue,
			filterLexer = loop.filterLexer,
			isArray = loopObject instanceof Array,
			newO = isArray ? [] : {};

		if(!filterLexer.hasVar(loopIndex, loopValue)){
			var filterO = filterLexer.calc(this.scopes);

			if(filterO instanceof Function){
				newO = $.filter(loopObject, filterO, this.scope);
			}
			//filter value is string or number type, or even bool, if both string, check contains, else check ===
			else if(filterO){
				if(typeof filterO === 'string'){
					filterO = filterO.toLowerCase();
				}

				for(var i in loopObject){
					var value = loopObject[i];
					
					if(value instanceof Object){
						for(var j in value){
							var vj = value[j];

							if(typeof filterO === 'string' && typeof vj === 'string' && vj.toLowerCase().contains(filterO) || filterO === vj){
								isArray ? newO.push(loopObject[i]) : newO[i] = loopObject[i];
								break;
							}
						}
					}
					else if(typeof filterO === 'string' && typeof value === 'string' && value.toLowerCase().contains(filterO) || filterO === value){
						isArray ? newO.push(loopObject[i]) : newO[i] = loopObject[i];
					}
				}
			}
			else{
				newO = loopObject;
			}
		}
		else{
			var scopes = [{}].concat(this.scopes);

			for(var i in loopObject){
				if(loopIndex){
					scopes[0][loopIndex] = i;
				}
				if(loopValue){
					scopes[0][loopValue] = loopObject[i];
				}

				if(filterLexer.calc(scopes)){
					isArray ? newO.push(loopObject[i]) : newO[i] = loopObject[i];
				}
			}
		}

		return newO;
	},

	doSort : function(loopObject, loop){
		var loopIndex = loop.loopIndex,
			loopValue = loop.loopValue,
			sortLexer = loop.sortLexer,
			sortDESC = loop.sortDESC,
			isArray = loopObject instanceof Array;

		if(sortLexer){
			if(!sortLexer.hasVar(loopIndex, loopValue)){
				var sortO = sortLexer.calc(this.scopes);

				if(sortO instanceof Function){
					loopObject = $.sort(loopObject, sortO, this.scope, sortDESC);
				}
			}
			else{
				var sortO = {},
					scopes = [{}].concat(this.scopes);

				for(var i in loopObject){
					if(loopIndex){
						scopes[0][loopIndex] = i;
					}
					if(loopValue){
						scopes[0][loopValue] = loopObject[i];
					}

					sortO[i] = sortLexer.calc(scopes);
				}

				loopObject = $.sort(loopObject, sortO, sortDESC);
			}
		}
		else{
			loopObject = $.sort(loopObject, sortDESC);
		}

		return loopObject;
	},

	//vars will exclude these properties, child closure will extend parent's staticVars
	staticVars : '$index $count $first $last $value'.split(' ').object(true),

	//support refresh vars name
	refreshLoops : function(loops, vars){
		var dirty = false;

		for(var i in loops){
			var loop = loops[i],
				loopLetsLexer = loop.loopLetsLexer,
				templeteClosure = loop.templeteClosure,
				commentNode = loop.commentNode,
				closures = loop.closures,
				closuresByKey = loop.closuresByKey,
				loopKeyLexer = loop.loopKeyLexer,
				index = 0;

			if(loop.loopLexer){
				//sync loopObject with closures, add, remove or update
				var loopObject = loop.loopLexer.calc(this.scopes);

				if(loopObject){
					var loopIndex = loop.loopIndex,
						loopValue = loop.loopValue;
	
					if(loop.willFilter){
						loopObject = this.doFilter(loopObject, loop);
					}

					if(loop.willSort){
						loopObject = this.doSort(loopObject, loop);
					}

					var count = loopObject instanceof Array ? loopObject.length : $.count(loopObject);

					if(loopKeyLexer){
						loop.closures = closures = [];
						loop.closuresByKey = {};
					}

					for(var j in loopObject){
						var isNew;

						if(loopKeyLexer){
							var tempScope = {};

							tempScope[loopIndex] = j;
							tempScope[loopValue] = loopObject[j];

							var key = loopKeyLexer.calc(this.tempScopes(tempScope)),
								closure = closuresByKey[key];

							isNew = !closure;

							if(isNew){
								closure = templeteClosure.clone(this);
								closure.letScope.$key = key;

								dirty = true;
							}
							else{
								delete closuresByKey[key];
							}
							
							commentNode.before(closure.els[0]);
							loop.closuresByKey[key] = closure;
							loop.closures.push(closure);
						}

						else{
							var closure = closures[index];

							isNew = !closure;

							if(isNew){
								closure = templeteClosure.clone(this);
								closures.push(closure);
								dirty = true;
							}

							commentNode.before(closure.els[0]);
						}

						if(loopIndex){
							closure.letScope[loopIndex] = j;
						}
						if(loopValue){
							closure.letScope[loopValue] = loopObject[j];
						}

						closure.letScope.$index = index;
						closure.letScope.$count = count;
						closure.letScope.$first = index === 0;
						closure.letScope.$last = index === count - 1;
						closure.letScope.$value = loopObject[j];

						if(loopLetsLexer && (isNew || loopLetsLexer.hasVar(loopIndex, loopValue, '$index', '$count'))){
							loopLetsLexer.calc(closure.scopes);
						}

						closure.lockDirty = this.lockDirty;
						closure.refresh.apply(closure, vars);
						closure.lockDirty = false;

						index++;
					}
				}
			}

			else{
				var	loopValue = loop.loopValue,
					loopStart = loop.loopStartLexer.calc(this.scopes),
					loopEnd = loop.loopEndLexer.calc(this.scopes),
					count = Math.abs(loopEnd - loopStart) + 1;
					index = 0;

				for(var j = loopStart; loopEnd >= loopStart ? j <= loopEnd : j >= loopStart; loopEnd >= loopStart ? j++ : j--){
					var closure = closures[index],
						isNew = !closure;

					if(!closure){
						closure = templeteClosure.clone(this);
						commentNode.before(closure.els[0]);
						closures.push(closure);

						dirty = true;
					}

					closure.letScope[loopValue] = j;

					closure.letScope.$index = index;
					closure.letScope.$count = count;
					closure.letScope.$first = index === 0;
					closure.letScope.$last = index === count - 1;
					closure.letScope.$value = j;

					if(loopLetsLexer && (isNew || loopLetsLexer.hasVar(loopValue, '$index', '$count'))){
						loopLetsLexer.calc(closure.scopes);
					}

					closure.lockDirty = this.lockDirty;
					closure.refresh.apply(closure, vars);
					closure.lockDirty = false;

					index++;
				}
			}

			if(loopKeyLexer){
				for(var key in closuresByKey){
					closuresByKey[key].els[0].remove();
				}
			}
			else if(index < closures.length){
				for(var j = closures.length - 1; j >= index; j--){
					closures.pop().els[0].remove();
				}

				dirty = true;
			}
		}

		if(dirty && !this.lockDirty){
			this.makeDirty();
		}

		return dirty;
	},

	refreshClasses : function(classes){
		var dirty = false;

		for(var i in classes){
			var cls = classes[i],
				instance = cls.instance || this.newInstance(cls),
				argLexers = cls.argLexers,
				lexer = cls.lexer,
				newArgs = [],
				classDirty = false;

			for(var j in argLexers){
				var argLexer = argLexers[j];

				if(argLexer instanceof $.Lexer){
					var newArg = argLexer.calc(this.scopes);

					if(newArg instanceof Function){
						newArg = newArg.bind(this.scope);
					}
					newArgs[j] = newArg;
				}
				else{
					newArgs[j] = argLexer;
				}
			}

			if(cls.lastArgs){
				for(var j in newArgs){
					if(newArgs[j] instanceof Object || cls.lastArgs[j] !== newArgs[j]){
						classDirty = true;
					}
				}
			}
			else{
				classDirty = true;
			}

			if(cls.name === 'list' && newArgs[0]){
				if(cls.willFilter){
					newArgs[0] = this.doFilter(newArgs[0], cls);
				}

				if(cls.willSort){
					newArgs[0] = this.doSort(newArgs[0], cls);
				}
			}

			if(classDirty){
				instance.update.apply(instance, newArgs);
				cls.lastArgs = newArgs;
			}

			if(lexer){
				var value = lexer.calc(this.scopes);

				if(value !== cls.lastValue){
					instance[cls.bind](value);
					classDirty = true;
				}
			}

			dirty = dirty || classDirty;
		}

		if(dirty && !this.lockDirty){
			this.makeDirty();
		}

		return dirty;
	},

	//query element from this.els, it's a quick method, not support select and selectAll
	query : function(sel){
		for(var i in this.els){
			var el = this.els[i].query(sel);

			if(el){
				return el;
			}
		}

		return null;
	},

	queryAll : function(sel){
		var els = [];

		for(var i in this.els){
			els.push.apply(els, this.els[i].query(sel));
		}

		return els;
	},

	//get loop object by css selector or index, if sel is node and loop comment node in it, get it
	loop : function(sel){
		if(sel instanceof Node){
			return this.loops.find(function(loop){return sel.contains(loop.commentNode);});
		}
		else if(typeof sel === 'string'){
			return this.loops.find(function(loop){return loop.node.is(sel);});
		}
		else if(typeof sel === 'number'){
			return this.loops[sel];
		}
	},

	//get class object by css selector or index, and key attribute which used to create the class, or the node
	class : function(sel, name){
		if(sel instanceof Node){
			return this.classes.find(function(cls){
				return (cls.node === sel || cls.instance.el === sel) && (!name || cls.name === name);
			});
		}
		else if(typeof sel === 'string'){
			return this.classes.find(function(cls){
				return (cls.node.is(sel) || cls.instance.el.is(sel)) && (!name || cls.name === name);
			});
		}
		else if(typeof sel === 'number'){
			return this.classes[sel];
		}
	},

	//get class instance by css selector or index
	instance : function(sel, name){
		var cls = this.class(sel, name);

		if(cls){
			return cls.instance;
		}
	},

	//get the looped closure by loop selector, closure selector, this selector can be index or key, or node which contains the loop
	closure : function(loopSel, cloSel){
		var loop = this.loop(loopSel);

		if(loop){
			if(typeof cloSel === 'string'){
				return loop.closuresByKey[cloSel];
			}
			else if(typeof cloSel === 'number'){
				return loop.closures[cloSel];
			}
		}
	}
});


$.Closure.scopes = {};
$.Closure.closures = {};


$.ready(function(){
	var els = document.documentElement.queryAll('*'),
		scopeEls = [];

	for(var i in els){
		var el = els[i];

		if(el.hasAttribute('$scope')){
			scopeEls.push(el);
		}
	}

	for(var i in scopeEls){
		var variable = scopeEls[i].getAttribute('$scope');

		if(variable){
			var scope = new $.Lexer(variable).calc([window]);
			if(scope){
				$.Closure.scopes[variable] = scope;
			}
		}
	}

	for(var i in scopeEls){
		var variable = scopeEls[i].getAttribute('$scope'),
			scope = new $.Lexer(variable).calc([window]),
			closure = new $.Closure(scopeEls[i], scope);

		if(variable){
			$.Closure.closures[variable] = closure;
		}

		if(scope){
			scope.clo = closure;
		}
	}
});


//query scope that bind to the parent node of el, or el as an global variable name
$.closure = function(el){
	if(typeof el === 'string'){
		return $.Closure.closures[el];
	}
	else{
		var node = el;

		while(node && node !== document.documentElement){
			if(node.$closure){
				return node.$closure;
			}
			node = node.parentNode;
		}

		return null;
	}
}
