# ZotLit and Zotero Integration Plugin Workflows

This document outlines two different workflows for integrating Zotero with Obsidian using the Obsidian Zotero Reader Plugin:

1. **ZotLit Workflow**
2. **Zotero Integration Plugin Workflow**

### Key Differences between two workflows

| Feature | ZotLit | Zotero Integration Plugin |
|---------|--------|---------------------------|
| Import existing annotations | ✅ Yes | ❌ No |
| Template flexibility | ✅ High | ✅ High |
| Zotero metadata access | ✅ Full | ✅ Full |
| Annotation creation | ✅ Create new | ✅ Create new |
| PDF, EPUB, Snapshot | ❌ Only PDF | ✅ ALL |
| Learning curve | Medium | Low |

---


## Zotero Integration Plugin Workflow

### Current Limitations
The Zotero Integration Plugin **cannot import existing annotations** from Zotero.


### Prerequisites
- Obsidian with Zotero Integration Plugin installed and configured
- Zotero desktop application running (with Better Bibtex)
- Obsidian Zotero Reader Plugin installed

### Workflow Steps

#### 1. Configure Template

Create a template in your Zotero Integration Plugin settings with the following content:

```markdown
---
zotero-reader: true
source: '{{firstAttachmentLink}}'
---

## {{title}}

### Formatted Bibliography

{{bibliography}}
{% if abstractNote %}

### Abstract

{{abstractNote}}
{% endif %}

%% OZRP-ANNO-BLOCKS-BEGIN %%

%% OZRP-ANNO-BLOCKS-END %%
```

#### 2. Create Literature Note

1. **Insert Citation**: Use the Zotero Integration Plugin command 
2. **Select Item**: Choose your Zotero item from the search results
3. **Select Template**: Choose the template configured above
4. **Generate Note**: The plugin will create a new note with proper metadata

#### 3. Open in Reader

1. **Open**: Click the zotero icon on the top right corner.
2. **Navigate**: The PDF will open in the Obsidian reader interface
3. **Ready for Annotations**: You can now create new annotations directly in Obsidian

#### 4. Create Annotations

- **Highlight Text**: Select text in the PDF and create highlights
- **Add Comments**: Add your notes and comments to annotations
- **Automatic Integration**: All annotations are automatically saved within the OZRP blocks

### Template Components Explanation

- **`zotero-reader: true`**: Essential flag for Obsidian Zotero Reader Plugin recognition
- **`source: '{{firstAttachmentLink}}'`**: Direct link to the first PDF attachment
- **`{{title}}`**: Zotero item title
- **`{{bibliography}}`**: Formatted citation in your chosen style
- **`{{abstractNote}}`**: Abstract from Zotero (if available)
- **`%% OZRP-ANNO-BLOCKS %%`**: Markers where annotations will be automatically inserted

### Key Limitations

- **No Import of Existing Annotations**: Cannot pull in annotations already made in Zotero
- **Forward-Only Sync**: Annotations created in Obsidian don't sync back to Zotero
- **Manual Process**: Each literature note must be created individually
- **Dependency on Zotero Desktop**: Requires Zotero application to be running


## ZotLit Workflow

### Current Limitations
Currently ZotLit only support PDF, not other form.

### Prerequisites

- Obsidian with Zotero Integration Plugin installed
- ZotLit plugin configured
- Existing annotations in Zotero (Optional)

### Configure ZotLit Templates

#### Template 1: `zt-field.eta`

Create a template file for field configuration:

```eta
zotero-reader: true
source: "<%= it.fileLink %>" 
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
<% } -%>

%% OZRP-ANNO-END %% 
^<%= it.blockID -%>
<% } -%>
```

**Purpose**: This template formats annotations in a way that the Obsidian Zotero Reader Plugin can parse and manage. It includes:
- Begin and end marker with json
- Quote sections with proper markers
- Comment sections with proper markers
- Unique annotation IDs for tracking

#### Template 3: `zt-note.eta`

Create a template file for annotation formatting:

```eta
# <%= it.title %>

[Zotero](<%= it.backlink %>) <%= it.fileLink %>

%% OZRP-ANNO-BLOCKS-BEGIN %%
<%~ include("annots", it.annotations) %>
%% OZRP-ANNO-BLOCKS-END %%
```

**Purpose**: This template let the plugin be able to insert the new annotations at the current position (inside the blocks marker)

### ZotLit Workflow

#### From Zotero Side:

1. **Create Literature Note**: Use ZotLit to create a literature note with the configured templates
2. **Import Annotations**: The templates will automatically format existing Zotero annotations
3. **Update in Obsidian**: After the note is created, use the command palette (`Ctrl/Cmd + P`) and run:
   ```
   Obsidian Zotero Reader: Update file's annotation to latest template
   ```

#### Expected Result:

- Literature note with properly formatted annotations
- Annotations recognized by Obsidian Zotero Reader Plugin

## Important Warnings and Best Practices

### ⚠️ Critical Warnings

1. **One-Way Import Only**: Only import annotations from Zotero once. Do not update literature notes from ZotLit/Zotero Integration Plugin again after the initial import.

2. **Avoid Re-importing**: Re-importing or updating from ZotLit will cause unexpected results and may overwrite local changes.

3. **Data Loss Risk**: Force updating by overwriting will cause the loss of all annotations and modifications made in Obsidian.

### 🔄 General Workflow

1. **Initial Setup**: Configure templates and perform the initial import
2. **Work in Obsidian**: Make all subsequent annotation edits and additions within Obsidian
3. **Avoid Updates**: Do not use ZotLit/Zotero Integration update functions on already imported notes


## Future Enhancements

Probably will writte my own Zotero bridge to work with the reader better in the future.

---

**Note**: This workflow is designed for users who want to leverage existing Zotero annotations in Obsidian while maintaining the ability to enhance and manage them through the Obsidian Zotero Reader Plugin. Always backup your notes before performing imports or updates.