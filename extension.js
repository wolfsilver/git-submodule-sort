const vscode = require('vscode');
const path = require('path');
const fs = require("fs").promises;
const parse = require('@babel/parser').parse;
const generate = require('@babel/generator').default;
const template = require('@babel/template').default;
const traverse = require('@babel/traverse').default;
const t = require('@babel/types');

const fileName = 'workbench.desktop.main.js';
const backUpFileName = 'workbench.desktop.main.origin.js';
const patchFileName = 'workbench.desktop.main.patch.js';
const sortRepositoriesBody = template.ast`let sortIndexs = visibleRepositories.map((repo, index) => ({ index, uri: repo.provider.rootUri.path, children: [] })); sortIndexs.sort((a, b) => b.uri.length - a.uri.length); for (let i = sortIndexs.length; i--;) { const repo = sortIndexs[i]; const rootUri = repo.uri + '/'; for (let j = i; j--;) { if (sortIndexs[j].uri.includes(rootUri)) { repo.children = sortIndexs.splice(j, 1).concat(repo.children); --i; } } } sortIndexs.sort((a, b) => a.index - b.index); sortIndexs = sortIndexs.reduce((acc, repo) => { acc.push(repo, ...repo.children); return acc; }, []); return sortIndexs.map(({ index }) => visibleRepositories[index]);`;

let BASE_PATH = '';


function getVSCodePath () {
	const app = path.dirname(require.main.filename);
	BASE_PATH = path.join(app, "vs", "workbench");
}

// backup
function backup () {

}

// body...
function restore() {

}


async function patch() {
	const config = vscode.workspace.getConfiguration("git-submodule-sort");
	const data = await fs.readFile(path.resolve(BASE_PATH, fileName), 'utf8')
	const ast = parse(data);
	transformer(ast, config.prefix);
	const { code } = generate(ast, {
		compact: true,
		concise: true,
	});
	output(code);
}

async function output(data) {
	await fs.writeFile(path.join(BASE_PATH, fileName), data).catch((e) => {
		console.error(e)
		vscode.window.showWarningMessage('git submodule sort patch failed!');
	})
	vscode.window.showInformationMessage('git submodule sort patch successed!');
}

function transformer(ast, prefix = '┡') {
	traverse(ast, {
		ClassMethod: function (path) {
			if (path.node.key.name === 'renderElement') {
				if (path.toString().includes('.provider.rootUri')) {
					console.log('find renderElement')
					let varVal = '';
					path.traverse({
						IfStatement: function (path) {
							path.traverse({
								VariableDeclarator: function (path) {
									varVal = path.node.id.name;
									console.log('find renderElement val', varVal)
								},
								CallExpression: function (path) {
									// r.name.textContent = f.basename(a.provider.rootUri)
									if (path.node.callee.type === 'MemberExpression' &&
										path.node.callee.property.name === 'basename'
									) {
										path.replaceWith(t.binaryExpression('+', t.conditionalExpression(t.identifier(varVal), t.stringLiteral(`${prefix} `), t.stringLiteral('')), path.node))
										path.skip()
									}
								}
							});
						}
					});
				}
			}
			if (path.node.kind === 'set' && path.node.key.name === 'visibleRepositories') {
				console.log('find set visibleRepositories')
				path.traverse({
					SequenceExpression: function (path) {
						path.traverse({
							AssignmentExpression: function (path) {
								if (path.node.left.type === 'MemberExpression' &&
									path.node.left.property.name === '_visibleRepositories') {
									path.node.right = (
										t.callExpression(
											t.memberExpression(
												t.thisExpression(),
												t.identifier('sortRepositories')
											), [path.node.right]
										)
									)
									path.skip()
								}
							}
						})
					}
				})
			}
			if (path.node.key.name === 'onDidAddRepository') {
				if (path.toString().includes('this._visibleRepositories.push')) {
					console.log('find onDidAddRepository')
					path.traverse({
						SequenceExpression: function (path) {
							path.traverse({
								CallExpression: function (path) {
									if (path.node.callee.type === 'MemberExpression' &&
										path.node.callee.property.name === 'push' &&
										path.node.callee.object.type === 'MemberExpression' &&
										path.node.callee.object.property.name === '_visibleRepositories'
									) {
										// this._visibleRepositories = this.sortRepositories(this._visibleRepositories)
										const exp = t.assignmentExpression('=',
											t.memberExpression(
												t.thisExpression(),
												t.identifier('_visibleRepositories')
											),
											t.callExpression(
												t.memberExpression(
													t.thisExpression(),
													t.identifier('sortRepositories')
												), [t.memberExpression(
													t.thisExpression(),
													t.identifier('_visibleRepositories')
												)]
											)
										)
										path.parent.expressions.splice(1, 0, exp)
										path.skip()
										path.parentPath.skip()
										// console.log('find this._visibleRepositories.push')
									}
								}
							});
						}
					});

					const sortRepositories = t.classMethod('method', t.identifier('sortRepositories'), [t.identifier('visibleRepositories')], t.blockStatement(sortRepositoriesBody))
					path.insertAfter(sortRepositories)
				}
			}
		},
	});
}


/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	getVSCodePath();
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "git-submodule-sort" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with  registerCommand
	// The commandId parameter must match the command field in package.json
	const patchInstall = vscode.commands.registerCommand('git-submodule-sort.patch', patch);
	context.subscriptions.push(patchInstall);
}

function deactivate() {}

module.exports = {
	activate,
	deactivate
}
