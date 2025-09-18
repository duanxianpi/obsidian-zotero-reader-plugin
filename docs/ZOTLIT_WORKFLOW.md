# ZotLit and Zotero Integration Plugin Workflow

This document outlines the workflow for partial integration between ZotLit and the Zotero Integration Plugin, specifically focusing on importing existing annotations from Zotero.

## Overview

The integration allows you to import existing annotations from Zotero using ZotLit, then manage them through the Obsidian Zotero Reader Plugin. This workflow is designed for one-way synchronization from Zotero to Obsidian.

## Prerequisites

- Obsidian with Zotero Integration Plugin installed
- ZotLit plugin configured
- Existing annotations in Zotero

## Workflow Steps

### 1. Configure ZotLit Templates

#### Template 1: `zt-field.eta`

Create a template file for field configuration:

```eta
<%
const m = it.fileLink.match(/\[(?:[^\]]+)\]\(\s*<?(file:\/\/\/[^>\s)]+)>?\s*\)/i)
const url = m ? m[1] : ''
%>

zotero-reader: true
source: "<%= decodeURIComponent(url) %>" 
```

**Purpose**: This template extracts the file URL from Zotero file links and sets up the necessary metadata for the Obsidian Zotero Reader Plugin to recognize the note.

#### Template 2: `zt-annot.eta`

Create a template file for annotation formatting:

```eta
---
callout: false
---
<% if (it.text) { -%>
%% OZRP-ANNO-BEGIN  {"type":"<%= ({1:"highlight",2:"note",3:"image",4:"ink",5:"underline",6:"text"})[it.type] %>","color":"<%= it.color %>","sortIndex":"<%~ it.sortIndex.join("|") %>","pageLabel":"<%= it.pageLabel %>","position":<%~ JSON.stringify(it.position) %>,"text":"","comment":"","tags":<%~ JSON.stringify(it.tags) %>,"id":"<%= it.key %>","dateCreated":"<%= it.dateAdded %>","dateModified":"<%= it.dateModified %>"}  %%
> %% OZRP-ANNO-QUOTE-BEGIN %%
> > <%= it.text -%>
 > %% OZRP-ANNO-QUOTE-END %%
> 
<% if (it.comment) { -%>
> %% OZRP-ANNO-COMM-BEGIN %%
> <%= it.comment -%>
> %% OZRP-ANNO-COMM-END %% 
<% } else { -%>
> %% OZRP-ANNO-COMM-BEGIN %% %% OZRP-ANNO-COMM-END %%
<< } -%>

%% OZRP-ANNO-END %%
<% } -%>
```

**Purpose**: This template formats annotations in a way that the Obsidian Zotero Reader Plugin can parse and manage. It includes:
- Annotation metadata (type, color, position, etc.)
- Quote sections with proper markers
- Comment sections with proper markers
- Unique annotation IDs for tracking

### 2. Import Process

#### From Zotero Side:

1. **Create Literature Note**: Use ZotLit to create a literature note with the configured templates
2. **Import Annotations**: The templates will automatically format existing Zotero annotations
3. **Update in Obsidian**: After the note is created, use the command palette (`Ctrl/Cmd + P`) and run:
   ```
   Obsidian Zotero Reader: Update
   ```

#### Expected Result:

- Literature note with properly formatted annotations
- Annotations recognized by Obsidian Zotero Reader Plugin
- Ability to manage annotations within Obsidian

### 3. Template Components Explanation

#### Field Template Components:
- **File Link Extraction**: Parses Zotero file links to extract the actual file URL
- **Metadata Setup**: Sets `zotero-reader: true` flag for plugin recognition
- **Source Attribution**: Provides the decoded file URL as the source

#### Annotation Template Components:
- **OZRP Markers**: Special comments that mark the beginning and end of annotations
- **Type Mapping**: Maps Zotero annotation types (1-6) to readable names
- **Position Data**: Preserves exact location information from Zotero
- **Quote/Comment Structure**: Maintains the original text and any associated comments

## Important Warnings and Best Practices

### ⚠️ Critical Warnings

1. **One-Way Import Only**: Only import annotations from Zotero once. Do not update literature notes from ZotLit again after the initial import.

2. **Avoid Re-importing**: Re-importing or updating from ZotLit will cause unexpected results and may overwrite local changes.

3. **Data Loss Risk**: Force updating by overwriting will cause the loss of all annotations and modifications made in Obsidian.

### 🔄 Recommended Workflow

1. **Initial Setup**: Configure templates and perform the initial import
2. **Work in Obsidian**: Make all subsequent annotation edits and additions within Obsidian
3. **Avoid ZotLit Updates**: Do not use ZotLit update functions on already imported notes

## Zotero Integration Plugin Considerations

### Current Status
- **TODO**: Full bidirectional sync capabilities
- **TODO**: Conflict resolution mechanisms
- **TODO**: Batch import/update features

### Limitations
- Currently supports one-way import only
- Manual update process required
- No automatic synchronization
- Risk of data loss with multiple import attempts

## Troubleshooting

### Common Issues

1. **Annotations Not Recognized**
   - Check that `zotero-reader: true` is set in the note frontmatter
   - Verify the source URL is correctly formatted
   - Ensure OZRP markers are properly formatted

2. **Update Command Not Working**
   - Confirm the Obsidian Zotero Reader Plugin is installed and enabled
   - Check that the note contains the proper metadata
   - Verify the file path in the source field is accessible

3. **Duplicate Annotations**
   - This typically occurs from multiple imports
   - Restore from backup or manually clean duplicates
   - Avoid re-running the import process

## Future Enhancements

- Bidirectional synchronization
- Conflict detection and resolution
- Batch processing capabilities
- Automated update mechanisms
- Better error handling and user feedback

---

**Note**: This workflow is designed for users who want to leverage existing Zotero annotations in Obsidian while maintaining the ability to enhance and manage them through the Obsidian Zotero Reader Plugin. Always backup your notes before performing imports or updates.