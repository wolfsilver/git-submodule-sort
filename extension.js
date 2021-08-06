const vscode = require('vscode');
const path = require('path');
const fs = require("fs");
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
let step = 0;


function getVSCodePath() {
	const app = path.dirname(require.main.filename);
	BASE_PATH = path.join(app, "vs", "workbench");
}

// backup
async function backup() {
	const unWritable = await fs.promises.access(path.resolve(BASE_PATH, fileName), fs.constants.W_OK).catch(() => true);
	if (unWritable) {
		vscode.window.showErrorMessage('VS Code can not modify itself.');
		return false;
	}
	const notBackup = await fs.promises.access(path.resolve(BASE_PATH, backUpFileName), fs.constants.F_OK).catch(e => {
		console.log('backup file not exist', e);
		return true;
	});
	if (notBackup) {
		await fs.promises.copyFile(path.resolve(BASE_PATH, fileName), path.resolve(BASE_PATH, backUpFileName));
	}
	return true;
}

// TODO
function restore() {

}


async function patch() {
	step = 0;
	const status = await backup();
	if (!status) {
		return;
	}
	const config = vscode.workspace.getConfiguration("git-submodule-sort");
	const data = await fs.promises.readFile(path.resolve(BASE_PATH, backUpFileName), 'utf8')
	const ast = parse(data);
	transformer(ast, config.prefix);
	if (step !== 4) {
		vscode.window.showErrorMessage('git submodule sort patch failed!!');
		return;
	}
	const { code } = generate(ast, {
		compact: true,
		concise: true,
	});
	output(code);
}

async function output(data) {
	await fs.promises.writeFile(path.join(BASE_PATH, fileName), data).catch((e) => {
		console.error(e)
		vscode.window.showWarningMessage('git submodule sort patch failed!');
	})
	vscode.window.showInformationMessage('git submodule sort patch successed! Restart to take effect.', { title: 'Restart VS Code' })
		.then(() => {
			vscode.commands.executeCommand("workbench.action.reloadWindow")
		});
}

function transformer(ast, prefix = '┡') {
	traverse(ast, {
		ClassMethod: function (path) {
			if (path.node.key.name === 'renderElement') {
				if (path.toString().includes('.provider.rootUri')) {
					let varVal = '';
					path.traverse({
						IfStatement: function (path) {
							path.traverse({
								VariableDeclarator: function (path) {
									varVal = path.node.id.name;
								},
								CallExpression: function (path) {
									// r.name.textContent = f.basename(a.provider.rootUri)
									// 1.59.0 a.name.textContent=(0,f.basename)(o.provider.rootUri)
									if (t.isAssignmentExpression(path.parent) && path.node.arguments[0] && path.node.arguments[0].type === 'MemberExpression' &&
										path.node.arguments[0].property.name === 'rootUri'
									) {
										if (!varVal) {
											return;
										}
										path.replaceWith(t.binaryExpression('+', t.conditionalExpression(t.identifier(varVal), t.stringLiteral(`${prefix} `), t.stringLiteral('')), path.node));
										path.skip();
										step++;
									}
								}
							});
						}
					});
				}
			}
			if (path.node.kind === 'set' && path.node.key.name === 'visibleRepositories') {
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
									path.skip();
									step++;
								}
							}
						})
					}
				})
			}
			if (path.node.key.name === 'onDidAddRepository') {
				if (path.toString().includes('this._visibleRepositories.push')) {
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
										path.parent.expressions.splice(1, 0, exp);
										path.skip();
										path.parentPath.skip();
										step++;
									}
								}
							});
						}
					});

					const sortRepositories = t.classMethod('method', t.identifier('sortRepositories'), [t.identifier('visibleRepositories')], t.blockStatement(sortRepositoriesBody))
					path.insertAfter(sortRepositories);
					step++;
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

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with  registerCommand
	// The commandId parameter must match the command field in package.json
	const patchInstall = vscode.commands.registerCommand('git-submodule-sort.patch', patch);
	context.subscriptions.push(patchInstall);
}

function deactivate() { }

module.exports = {
	activate,
	deactivate
}
