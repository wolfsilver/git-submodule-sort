# git-submodule-sort

If both repositories use the same submodule, the VS code looks like this.
![](https://user-images.githubusercontent.com/2452450/114032085-8f400100-98ae-11eb-8acd-f03e1bf67444.png)

Therefore, this extension tries to make it clear. Like this.
![](https://user-images.githubusercontent.com/2452450/114032112-96670f00-98ae-11eb-8b27-7086bb9d9648.png)

## Usage
open command palette (use `F1`, `Ctrl+Shift+P` (Windows & Linux) or `Cmd+Shift+P` (OS X))
then select command `Enable git submodule sort`


## Requirements

This extension would NOT work if Visual Studio Code cannot modify itself.

## Extension Settings

submodule repo prefix

* `git-submodule-sort.prefix`: default is '┡'

## Known Issues

If VS Code complains about that it is corrupted, simply click “Don't show again”.
## Release Notes

### 0.0.1

patch 1.58.x