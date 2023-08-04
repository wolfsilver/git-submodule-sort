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

// restore
async function restore() {
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
		vscode.window.showErrorMessage('There is not a backup file.');
		return;
	}
	await fs.promises.copyFile(path.resolve(BASE_PATH, backUpFileName), path.resolve(BASE_PATH, fileName));
	vscode.window.showInformationMessage('restored.');
}



async function patch() {
	vscode.window.showInformationMessage('git submodule sort patch starts. It will take some time.')
	step = 0;
	const status = await backup();
	if (!status) {
		return;
	}
	const config = vscode.workspace.getConfiguration("git-submodule-sort");
	const data = await fs.promises.readFile(path.resolve(BASE_PATH, backUpFileName), 'utf8')
	const ast = parse(data, {
		plugins: [
			"classStaticBlock",
		],
	});

	const sortRepositoriesBody = template.ast(`function _sort(repos, prefix) {
  repos.sort((a, b) => b.uri.length - a.uri.length);
  for (let i = repos.length; i--;) {
    const repo = repos[i];
    const rootUri = repo.uri + '/';
    for (let j = i; j--;) {
      if (repos[j].uri.includes(rootUri)) {
        repos[j].prefix = prefix;
        repo.children = repos.splice(j, 1).concat(repo.children);
        --i;
      }
    }
    repo.children = _sort(repo.children, '　' + prefix);
  }
  repos.sort((a, b) => a.index - b.index);
  return repos.reduce((acc, repo) => { acc.push(repo, ...repo.children); return acc; }, []);
}


let sortIndexs = visibleRepositories.map((repo, index) => ({
  index,
  uri: repo.repository.provider.rootUri.path,
  children: []
}));

let sortedIndex = _sort(sortIndexs, '${config.prefix || '┡'} ');
const sorted = sortedIndex.map(({ index, prefix }) => {
  visibleRepositories[index].repository.provider.prefix = prefix;
  return visibleRepositories[index];
});
return sorted;`);

	transformer(ast, sortRepositoriesBody);
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

function transformer(ast, sortRepositoriesBody) {
	traverse(ast, {
		ClassMethod: function (path) {
			if (path.node.key.name === 'renderElement') {
				if (path.toString().includes('.provider.rootUri')) {
					path.traverse({
						IfStatement: function (path) {
							path.traverse({
								CallExpression: function (path) {
									// r.name.textContent = f.basename(a.provider.rootUri)
									// 1.59.0 a.name.textContent=(0,f.basename)(o.provider.rootUri)
									if (t.isAssignmentExpression(path.parent) && path.node.arguments[0] && path.node.arguments[0].type === 'MemberExpression' &&
										path.node.arguments[0].property.name === 'rootUri'
									) {
										path.replaceWith(
											t.binaryExpression(
												'+',
												t.logicalExpression(
													"||",
													t.memberExpression(
														t.memberExpression(t.identifier(path.node.arguments[0].object.object.name), t.identifier('provider')),
														t.identifier('prefix')
													),
													t.stringLiteral('')
												),
												path.node
											)
										);
										path.skip();
										step++;
									}
								}
							});
						}
					});
				}
			}
			if (path.node.kind === 'get' && path.node.key.name === 'visibleRepositories') {
				const propertyName = path.node.body.body[0].argument.consequent.callee.object.callee.object.callee.object.property.name
				const getRepositoriesBody = template.ast(`return this.sortRepositories(this.${propertyName})
					.filter(r => r.selectionIndex !== -1)
					.map(r => r.repository);`);
				path.node.body = t.blockStatement([getRepositoriesBody])
				step++;

				path.parentPath.traverse({
					ClassMethod: function (path) {
						if (path.node.kind === 'get' && path.node.key.name === 'repositories') {
							const propertyName = path.node.body.body[0].argument.callee.object.property.name;
							const getRepositoriesBody = template.ast(`return this.sortRepositories(this.${propertyName}).map(o => o.repository);`);
							path.node.body = t.blockStatement([getRepositoriesBody])
							step++;
						}
						if (path.node.key.name === 'toggleVisibility') {
							if (path.toString().includes('this.visibleRepositories')) {
								const sortRepositories = t.classMethod('method', t.identifier('sortRepositories'), [t.identifier('visibleRepositories')], t.blockStatement(sortRepositoriesBody))
								path.insertAfter(sortRepositories);
								step++;
							}
						}
					}
				});
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

	const restorePatchInstall = vscode.commands.registerCommand('git-submodule-sort.restore', restore);
	context.subscriptions.push(restorePatchInstall);
}

function deactivate() { }

module.exports = {
	activate,
	deactivate
}
