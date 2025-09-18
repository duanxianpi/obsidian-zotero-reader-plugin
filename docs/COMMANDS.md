# Commands

The plugin provides several commands accessible through the Command Palette (Ctrl/Cmd+P):

## Update File Annotations Template
**Command ID:** `update-file-annotations-template`

Updates all annotations in the currently active markdown file to use the latest annotation block template. This is useful when you've modified your template and want to apply the changes to existing annotations.

## Update All Annotations Template
**Command ID:** `update-all-annotations-template`

Updates all annotations across your entire vault to use the latest annotation block template. This command scans all markdown files in your vault and updates any found annotations.

**⚠️ Warning:** This command affects all files in your vault. Make sure to backup your vault before running this command.
