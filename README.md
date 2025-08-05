# vm-2013

In 2013, I'm learning AngularJS v1, but find it's source codes are unbelievably difficult to read.

So followed Angular APIs I wrote this small library with only 2k lines of codes, it's absolutely primitive and rough, which includes only two parts:

- **Lexer**: execute codes.
- **Closure**: compile template to codes.

This library was used in some small internal projects within my department in MorningStar.



### Examples

```html
<div $scope="userPicker">
	<header>{{t('name')}}</header>
	<input type="text" list="names-list" $bind="name" $change="onChangeUserName">
	<datalist id="names-list">
		<option $loop="user of users">{{user.name}}</option>
	</datalist>
	Your name is: {{name}}
</div>
```

```js
var userPicker = {
	name: '',
	users: [{id, name}, ...],
	onChangeUserName: function() {...},
}
```



### Look back

When coding, I realized `$bind="name"` will change `name` property. So naturally after `name` property changed, only need to update places where reply on `name` like `{{name}}`. So I implemented it.