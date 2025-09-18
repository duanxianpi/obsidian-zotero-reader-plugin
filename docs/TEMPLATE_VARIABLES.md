# Template Variables Documentation

This document explains the template system used in the Obsidian Zotero Reader Plugin and lists all available variables for each template type.

## Template Engine

The plugin uses [Nunjucks](https://mozilla.github.io/nunjucks/) templating engine, which supports:

- Variable substitution: `{{ variable }}`
- Conditional statements: `{% if condition %} ... {% endif %}`
- Loops: `{% for item in items %} ... {% endfor %}`
- Filters: `{{ variable | filter }}`
- Comments: `{# This is a comment #}`

## Template Types

The plugin provides three different template types, each with its own set of available variables:

### 1. Annotation Block Template

This template is used when creating annotation blocks in your markdown files. It defines how annotations (highlights, notes, underlines, etc.) are formatted when imported from the reader.

Before changing the template for annotation block, you need to make sure that your template be wrapped by

```markdown
%% OZRP-ANNO-BEGIN {{rawJson}} %%

%% OZRP-ANNO-END %%
```

Plugin looking for this to identify the annotation block.

In addition, the quote and comment need be wrapped by

```
%% OZRP-ANNO-QUOTE-BEGIN %%

%% OZRP-ANNO-QUOTE-END %%
```
and
```
%% OZRP-ANNO-COMM-BEGIN %%

%% OZRP-ANNO-COMM-END %%
```
The quote mark is not mandatory.


**Template Setting:** `Annotation Block Template`

#### Available Variables

| Variable | Type | Description | Example |
|----------|------|-------------|---------|
| `rawJson` | string | JSON representation of the annotation data | `{"id":"abc123","type":"highlight"...}` |
| `type` | string | Type of annotation | `highlight`, `underline`, `note`, `text`, `image` |
| `color` | string | Color name of the annotation | `yellow`, `red`, `green`, `blue`, `purple`, `magenta`, `orange`, `gray` |
| `source` | string | Source document name (filename without extension) | `document` |
| `pageLabel` | string | Page label/number where annotation appears | `5`, `iii`, `A-1` |
| `link` | string | Obsidian URI link to the annotation | `obsidian://zotero-reader?file=...&navigation=...` |
| `quote` | string | The highlighted/selected text content | `This is the highlighted text` |
| `comment` | string | User's comment/note on the annotation | `This is my comment` |
| `id` | string | Unique identifier for the annotation | `abc123def456` |

#### Default Template

```nunjucks
%% OZRP-ANNO-BEGIN {{rawJson}} %%
> [!ozrp-{{ type }}-{{ color }}] [{{source}}, page {{pageLabel}}]({{link}})
> %% OZRP-ANNO-QUOTE-BEGIN %%
> > {{ quote }}
> %% OZRP-ANNO-QUOTE-END %%
> 
{%- if comment.trim() %}
> %% OZRP-ANNO-COMM-BEGIN %%
> {{ comment }}
> %% OZRP-ANNO-COMM-END %% ^{{ id }}
{%- else %}
> %% OZRP-ANNO-COMM-BEGIN %% %% OZRP-ANNO-COMM-END %% ^{{ id }}
{%- endif %}

%% OZRP-ANNO-END %%
```

### 2. Copy Link to Selection Template

This template is used when you right-click on selected text in the reader and choose "Copy Link to Selection".

**Template Setting:** `Copy Link to Selection Template`

#### Available Variables

| Variable | Type | Description | Example |
|----------|------|-------------|---------|
| `selectedText` | string | The text that was selected in the reader | `This is the selected text` |
| `pageLabel` | string | Page number where selection appears | `5` |
| `link` | string | Obsidian URI link to the selection location | `obsidian://zotero-reader?file=...&navigation=...` |

#### Default Template

```nunjucks
> {{selectedText}} [page, {{pageLabel}}]({{link}})
```

### 3. Copy Link to Annotation Template

This template is used when copying links to existing annotations (e.g., via drag-and-drop or Ctrl/Cmd+C when "Annotation" copy type is selected).

**Template Setting:** `Copy Link to Annotation Template`

#### Available Variables

| Variable | Type | Description | Example |
|----------|------|-------------|---------|
| `annotationText` | string | The text content of the annotation | `This is the annotation text` |
| `annotationComment` | string | The comment/note on the annotation | `This is my comment` |
| `annotationType` | string | Type of annotation | `highlight`, `underline`, `note`, `text`, `image` |
| `pageLabel` | string | Page label/number where annotation appears | `5`, `iii`, `A-1` |
| `link` | string | Obsidian link to the annotation (using block reference) | `file.md#^abc123` |

#### Default Template

```nunjucks
> {{annotationText}} [page, {{pageLabel}}]({{link}})
```

## Nunjucks Features You Can Use

### Conditional Logic

```nunjucks
{% if comment.trim() %}
Comment: {{ comment }}
{% else %}
No comment provided
{% endif %}
```

### String Filters

```nunjucks
{{ quote | upper }}          {# Uppercase #}
{{ comment | lower }}        {# Lowercase #}
{{ source | title }}         {# Title Case #}
{{ text | truncate(100) }}   {# Truncate to 100 chars #}
```

### String Methods

```nunjucks
{% if comment.trim() %}      {# Check if comment exists after trimming whitespace #}
{{ quote.replace("old", "new") }}  {# Replace text #}
```

### Loops (if working with arrays)

While most variables are strings, you can use loops if needed:

```nunjucks
{% for char in quote %}
{{ char }}
{% endfor %}
```

## Tips for Template Creation

1. **Test incrementally**: Make small changes and test to ensure your template works as expected.

2. **Use the trim filter**: Use `| trim` to remove unwanted whitespace:
   ```nunjucks
   {% if comment | trim %}
   ```

3. **Escape special characters**: If you need literal braces, use:
   ```nunjucks
   {{ "{{" }} and {{ "}}" }}
   ```

4. **Handle empty values**: Always check if optional fields like `comment` have content:
   ```nunjucks
   {% if comment and comment.trim() %}
   ```

5. **Use block references**: The `^{{ id }}` syntax creates Obsidian block references for easy linking.
