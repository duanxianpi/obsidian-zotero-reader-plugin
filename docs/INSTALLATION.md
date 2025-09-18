# Installation Guide

This guide will walk you through installing the Obsidian Zotero Reader Plugin.

## Prerequisites

- Obsidian v0.15.0 or higher
- [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat) (for beta installation)

## Installation Methods

### Method 1: BRAT Plugin (Recommended for Beta)

> **Note:** This plugin is currently in beta and not available in the official Obsidian Community Plugins store yet.

1. **Install BRAT Plugin**
   - Open Obsidian Settings (⚙️)
   - Go to **Community plugins**
   - Click **Browse** and search for "BRAT"
   - Install and enable the **Obsidian 42 - BRAT** plugin

2. **Add Beta Plugin**
   - In Obsidian, open **Settings → Community plugins**
   - Find **BRAT** in your installed plugins and click **Options**
   - Click **Add Beta plugin**
   - Enter the repository: `duanxianpi/obsidian-zotero-reader-plugin`
   - Click **Add Plugin**

3. **Enable Plugin**
   - Go to **Settings → Community plugins**
   - Find **Obsidian Zotero Reader** in the list
   - Toggle it on to enable

### Method 2: Manual Installation (Advanced Users)

1. **Download Release**
   - Go to the [GitHub releases page](https://github.com/duanxianpi/obsidian-zotero-reader-plugin/releases)
   - Download the latest release files: `main.js`, `manifest.json`, and `styles.css`

2. **Install Files**
   - Navigate to your vault's plugins folder: `YourVault/.obsidian/plugins/`
   - Create a new folder: `obsidian-zotero-reader-plugin`
   - Place the downloaded files in this folder

3. **Enable Plugin**
   - Reload Obsidian
   - Go to **Settings → Community plugins**
   - Enable **Obsidian Zotero Reader**

## Verification

To verify the installation was successful:

1. Create a new Markdown file
2. Add the following frontmatter:
   ```yaml
   ---
   zotero-reader: true
   source: path/to/your/document.pdf
   ---
   ```
3. You should see a Zotero icon in the file's header
4. Clicking the icon should open the reader interface
