"use strict";
// =============================================
// COMMON UTILITIES
// =============================================
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
// Polyfill for padStart.
function padStartPolyfill(str, targetLength, padString = " ") {
    targetLength = targetLength >> 0; // floor if number or convert non-number to 0
    if (str.length >= targetLength) {
        return str;
    }
    else {
        targetLength = targetLength - str.length;
        if (targetLength > padString.length) {
            padString += padString.repeat(Math.ceil(targetLength / padString.length));
        }
        return padString.slice(0, targetLength) + str;
    }
}
// Type guards
function isVariableAlias(value) {
    return value && typeof value === "object" && value.type === "VARIABLE_ALIAS";
}
function isRGBorRGBA(value) {
    return value && typeof value === "object" && "r" in value && "g" in value && "b" in value;
}
// =============================================
// EXPORT FUNCTIONALITY (FIRST PLUGIN)
// =============================================
/**
 * Helper function: Converts an RGB/RGBA color to a hex string if fully opaque.
 * Otherwise returns an rgba() string with the alpha value rounded to two decimal places.
 */
function convertColorToCSS(rawValue) {
    if (!isRGBorRGBA(rawValue))
        return rawValue.toString();
    const r = Math.round(rawValue.r * 255);
    const g = Math.round(rawValue.g * 255);
    const b = Math.round(rawValue.b * 255);
    const alpha = ("a" in rawValue ? rawValue.a : 1);
    if (alpha === 1) {
        // Fully opaque - convert to hex using the polyfill.
        const rHex = padStartPolyfill(r.toString(16), 2, "0");
        const gHex = padStartPolyfill(g.toString(16), 2, "0");
        const bHex = padStartPolyfill(b.toString(16), 2, "0");
        return `#${rHex}${gHex}${bHex}`;
    }
    else {
        // Not fully opaque, use rgba() with alpha fixed to two decimal places.
        return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
    }
}
/**
 * Returns a display value for a variable in a specific mode.
 * Uses the variable's raw values (valuesByMode).
 * If the raw value is an alias, returns "alias:" prefixed to the alias variable's name.
 * Otherwise, it converts the value.
 */
function getVariableDisplayValueForMode(variable, modeId) {
    return __awaiter(this, void 0, void 0, function* () {
        const rawValues = (variable).valuesByMode;
        if (!rawValues || !(modeId in rawValues))
            return "N/A";
        const rawValue = rawValues[modeId];
        if (isVariableAlias(rawValue)) {
            const aliasVar = yield figma.variables.getVariableByIdAsync(rawValue.id);
            if (aliasVar) {
                if (aliasVar.resolvedType === "COLOR") {
                    const aliasRawValues = (aliasVar).valuesByMode;
                    let colorValue = "";
                    if (aliasRawValues && aliasRawValues[modeId]) {
                        colorValue = convertColorToCSS(aliasRawValues[modeId]);
                    }
                    // Return alias with a delimiter separating the alias name and the color.
                    return "alias:" + aliasVar.name + colorValue;
                }
                return "alias:" + aliasVar.name;
            }
            return "alias:Unknown";
        }
        else {
            switch (variable.resolvedType) {
                case "COLOR":
                    return convertColorToCSS(rawValue);
                case "STRING":
                case "FLOAT":
                case "BOOLEAN":
                    return rawValue.toString();
                default:
                    return rawValue.toString();
            }
        }
    });
}
/**
 * Scans all local variables and returns for each variable an object that includes:
 *    - name: the variable's name
 *    - collectionId: the collection to which it belongs
 *    - modeValues: an object mapping mode IDs to the variable's display value in that mode.
 */
function scanVariablesByMode() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const localVariables = yield figma.variables.getLocalVariablesAsync();
            const result = [];
            for (const variable of localVariables) {
                const collectionId = variable.variableCollectionId || "";
                const modeValues = {};
                const rawValues = variable.valuesByMode;
                if (rawValues) {
                    const modeIds = Object.keys(rawValues);
                    for (const modeId of modeIds) {
                        modeValues[modeId] = yield getVariableDisplayValueForMode(variable, modeId);
                    }
                }
                // Here we assume that the variable may contain a "codeSyntax" property.
                const codeSyntax = variable.codeSyntax || "";
                result.push({ name: variable.name, collectionId, modeValues, codeSyntax });
            }
            return result;
        }
        catch (error) {
            figma.ui.postMessage({
                type: "error",
                message: "Error scanning variables by mode: " +
                    (error instanceof Error ? error.message : "Unknown error"),
            });
            return [];
        }
    });
}
/**
 * Retrieves available variable collections and maps necessary data:
 *    - id, name, and modes (each mode has modeId and name).
 */
function getAvailableCollections() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const collections = yield figma.variables.getLocalVariableCollectionsAsync();
            return collections.map((collection) => ({
                id: collection.id,
                name: collection.name,
                modes: collection.modes ? collection.modes.map((mode) => ({ modeId: mode.modeId, name: mode.name })) : [],
            }));
        }
        catch (error) {
            figma.ui.postMessage({
                type: "error",
                message: "Error retrieving collections: " +
                    (error instanceof Error ? error.message : "Unknown error"),
            });
            return [];
        }
    });
}
// =============================================
// IMPORT FUNCTIONALITY (SECOND PLUGIN)
// =============================================
function parseCSSVariables(cssText) {
    var _a, _b, _c, _d;
    const collections = [];
    let currentCollection = null;
    let currentMode = null;
    // Split by CSS comment blocks to find collection and mode definitions
    const lines = cssText.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        // Check for collection name
        if (line.startsWith('/*') && line.includes('Collection name:')) {
            const collectionName = (_b = (_a = line.match(/Collection name:\s*([^*]+)/)) === null || _a === void 0 ? void 0 : _a[1]) === null || _b === void 0 ? void 0 : _b.trim();
            if (collectionName) {
                currentCollection = {
                    name: collectionName,
                    modes: new Map()
                };
                collections.push(currentCollection);
            }
        }
        // Check for mode name
        else if (line.startsWith('/*') && line.includes('Mode:')) {
            const modeName = (_d = (_c = line.match(/Mode:\s*([^*]+)/)) === null || _c === void 0 ? void 0 : _c[1]) === null || _d === void 0 ? void 0 : _d.trim();
            if (modeName && currentCollection) {
                currentMode = modeName;
                currentCollection.modes.set(currentMode, []);
            }
        }
        // Parse CSS variables
        else if (line.includes('--') && line.includes(':') && currentCollection && currentMode) {
            const match = line.match(/--([^:]+):\s*([^;]+);?/);
            if (match) {
                const name = match[1].trim();
                const value = match[2].trim();
                const variables = currentCollection.modes.get(currentMode) || [];
                variables.push({ name, value });
                currentCollection.modes.set(currentMode, variables);
            }
        }
    }
    return collections;
}
function createFigmaVariables(collections) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        // Create maps to store variable references and their types
        const variableMap = new Map();
        const variableTypes = new Map();
        const variableValues = new Map();
        // First pass: Collect all variables and their values
        for (const collection of collections) {
            for (const [modeName, variables] of collection.modes.entries()) {
                for (const variable of variables) {
                    const varKey = `${collection.name}:${variable.name}`;
                    variableValues.set(`--${variable.name}`, variable.value);
                }
            }
        }
        // Second pass: Determine variable types
        for (const collection of collections) {
            for (const [modeName, variables] of collection.modes.entries()) {
                for (const variable of variables) {
                    const varKey = `${collection.name}:${variable.name}`;
                    if (!variableTypes.has(varKey)) {
                        let type;
                        // If it's a variable reference, try to determine the type from the referenced variable
                        if (variable.value.startsWith('var(--')) {
                            const referencedVarName = (_a = variable.value.match(/var\(--([^)]+)\)/)) === null || _a === void 0 ? void 0 : _a[1];
                            if (referencedVarName) {
                                // Try to find the referenced variable's value
                                const referencedValue = variableValues.get(`--${referencedVarName}`);
                                if (referencedValue) {
                                    // If the referenced value is also a reference, we need to go deeper
                                    if (referencedValue.startsWith('var(--')) {
                                        // For now, use a heuristic based on the variable name
                                        type = determineTypeFromName(variable.name);
                                    }
                                    else {
                                        // If the referenced value is a direct value, determine its type
                                        type = determineVariableType(referencedValue);
                                    }
                                }
                                else {
                                    // If we can't find the referenced value, use a heuristic
                                    type = determineTypeFromName(variable.name);
                                }
                            }
                            else {
                                type = determineTypeFromName(variable.name);
                            }
                        }
                        else {
                            // For direct values, determine the type from the value
                            type = determineVariableType(variable.value);
                        }
                        variableTypes.set(varKey, type);
                    }
                }
            }
        }
        // Third pass: Create collections and variables
        for (const collection of collections) {
            // Get all collections asynchronously
            const figmaCollections = yield figma.variables.getLocalVariableCollectionsAsync();
            let figmaCollection = figmaCollections.find(c => c.name === collection.name);
            // Create collection if it doesn't exist
            if (!figmaCollection) {
                const firstModeName = Array.from(collection.modes.keys())[0] || "Default";
                figmaCollection = figma.variables.createVariableCollection(collection.name);
                if (figmaCollection.modes.length > 0) {
                    const defaultMode = figmaCollection.modes[0];
                    figmaCollection.renameMode(defaultMode.modeId, firstModeName);
                }
            }
            // Process each mode in the collection
            for (const [modeName, variables] of collection.modes.entries()) {
                // Check if mode exists, create if not
                let modeId = (_b = figmaCollection.modes.find(m => m.name === modeName)) === null || _b === void 0 ? void 0 : _b.modeId;
                if (!modeId) {
                    if (modeName === ((_c = figmaCollection.modes[0]) === null || _c === void 0 ? void 0 : _c.name)) {
                        modeId = figmaCollection.modes[0].modeId;
                    }
                    else {
                        modeId = figmaCollection.addMode(modeName);
                    }
                }
                // Get all variables asynchronously
                const figmaVariables = yield figma.variables.getLocalVariablesAsync();
                // Create all variables
                for (const variable of variables) {
                    // Check if variable exists
                    let figmaVariable = figmaVariables
                        .find(v => v.name === variable.name && v.variableCollectionId === figmaCollection.id);
                    // Create variable if it doesn't exist
                    if (!figmaVariable) {
                        const varKey = `${collection.name}:${variable.name}`;
                        const variableType = variableTypes.get(varKey) || determineVariableType(variable.value);
                        figmaVariable = figma.variables.createVariable(variable.name, figmaCollection, variableType);
                    }
                    // Store the variable for later reference
                    variableMap.set(`--${variable.name}`, figmaVariable);
                }
            }
        }
        // Fourth pass: Set values after all variables are created
        for (const collection of collections) {
            const figmaCollection = yield figma.variables.getLocalVariableCollectionsAsync()
                .then(collections => collections.find(c => c.name === collection.name));
            if (figmaCollection) {
                for (const [modeName, variables] of collection.modes.entries()) {
                    const modeId = (_d = figmaCollection.modes.find(m => m.name === modeName)) === null || _d === void 0 ? void 0 : _d.modeId;
                    if (modeId) {
                        for (const variable of variables) {
                            const figmaVariable = variableMap.get(`--${variable.name}`);
                            if (figmaVariable) {
                                try {
                                    const value = yield parseVariableValue(variable.value, figmaVariable.resolvedType, variableMap);
                                    figmaVariable.setValueForMode(modeId, value);
                                }
                                catch (error) {
                                    // Properly handle the unknown error type
                                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                                    console.error(`Error setting value for variable ${variable.name}: ${errorMessage}`);
                                }
                            }
                        }
                    }
                }
            }
        }
    });
}
// Helper function to determine variable type from its name
function determineTypeFromName(name) {
    const lowerName = name.toLowerCase();
    // Check for color-related names
    if (lowerName.includes('color') ||
        lowerName.includes('background') ||
        lowerName.includes('bg-') ||
        lowerName.includes('border') ||
        lowerName.includes('fill') ||
        lowerName.includes('stroke') ||
        lowerName.includes('shadow')) {
        return 'COLOR';
    }
    // Check for number-related names
    if (lowerName.includes('weight') ||
        lowerName.includes('size') ||
        lowerName.includes('scale') ||
        lowerName.includes('spacing') ||
        lowerName.includes('radius') ||
        lowerName.includes('opacity') ||
        lowerName.includes('width') ||
        lowerName.includes('height') ||
        lowerName.includes('padding') ||
        lowerName.includes('margin')) {
        return 'FLOAT';
    }
    // Default to STRING for other names
    return 'STRING';
}
function determineVariableType(value) {
    var _a, _b;
    // Check if it's a reference to another variable
    if (value.startsWith('var(--')) {
        // For references, we need to determine the type based on the variable name or context
        const referencedVarName = (_b = (_a = value.match(/var\(--([^)]+)\)/)) === null || _a === void 0 ? void 0 : _a[1]) === null || _b === void 0 ? void 0 : _b.toLowerCase();
        if (referencedVarName) {
            // Try to infer type from variable name
            if (referencedVarName.includes('color') ||
                referencedVarName.includes('background') ||
                referencedVarName.includes('border') ||
                referencedVarName.includes('fill') ||
                referencedVarName.includes('stroke')) {
                return 'COLOR';
            }
            if (referencedVarName.includes('weight') ||
                referencedVarName.includes('size') ||
                referencedVarName.includes('scale') ||
                referencedVarName.includes('spacing') ||
                referencedVarName.includes('radius') ||
                referencedVarName.includes('opacity')) {
                return 'FLOAT';
            }
            if (referencedVarName.includes('font') ||
                referencedVarName.includes('family') ||
                referencedVarName.includes('text') ||
                referencedVarName.includes('name')) {
                return 'STRING';
            }
            // Default to STRING for variable references if we can't determine
            return 'STRING';
        }
    }
    // Check if it's a color
    if (value.startsWith('#') ||
        value.startsWith('rgb') ||
        value.startsWith('rgba') ||
        value.startsWith('hsl') ||
        value.startsWith('hsla')) {
        return 'COLOR';
    }
    // Check if it's a number with units (for FLOAT)
    if (/^-?\d+(\.\d+)?(px|rem|em|%|vw|vh|vmin|vmax)$/.test(value)) {
        return 'FLOAT';
    }
    // Check if it's a plain number
    if (/^-?\d+(\.\d+)?$/.test(value)) {
        return 'FLOAT';
    }
    // Default to STRING for anything else
    return 'STRING';
}
function parseVariableValue(value, type, variableMap) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        // Handle variable references
        if (value.startsWith('var(--')) {
            const referencedVarName = (_a = value.match(/var\(--([^)]+)\)/)) === null || _a === void 0 ? void 0 : _a[1];
            if (referencedVarName) {
                // Find the referenced variable from our map
                const referencedVar = variableMap.get(`--${referencedVarName}`);
                if (referencedVar) {
                    // Return a variable alias regardless of type
                    // Figma will handle the type conversion if needed
                    return {
                        type: 'VARIABLE_ALIAS',
                        id: referencedVar.id
                    };
                }
                else {
                    // If referenced variable doesn't exist yet, provide a default value based on type
                    switch (type) {
                        case 'COLOR':
                            return { r: 0, g: 0, b: 0 }; // Default black
                        case 'FLOAT':
                            return 0;
                        case 'BOOLEAN':
                            return false;
                        case 'STRING':
                        default:
                            return value;
                    }
                }
            }
        }
        // Handle direct values based on type
        switch (type) {
            case 'COLOR':
                return parseColorValue(value);
            case 'FLOAT':
                return parseFloatValue(value);
            case 'BOOLEAN':
                return value.toLowerCase() === 'true';
            case 'STRING':
            default:
                return value;
        }
    });
}
function parseColorValue(value) {
    // Handle hex colors
    if (value.startsWith('#')) {
        return hexToRgb(value);
    }
    // Handle rgba colors
    if (value.startsWith('rgba')) {
        const match = value.match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/);
        if (match) {
            return {
                r: parseInt(match[1]) / 255,
                g: parseInt(match[2]) / 255,
                b: parseInt(match[3]) / 255,
                a: parseFloat(match[4])
            };
        }
    }
    // Handle rgb colors
    if (value.startsWith('rgb')) {
        const match = value.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
        if (match) {
            return {
                r: parseInt(match[1]) / 255,
                g: parseInt(match[2]) / 255,
                b: parseInt(match[3]) / 255
            };
        }
    }
    // Default fallback
    return { r: 0, g: 0, b: 0 };
}
function hexToRgb(hex) {
    // Remove # if present
    hex = hex.replace('#', '');
    // Handle shorthand hex
    if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    // Handle hex with alpha
    if (hex.length === 8) {
        const r = parseInt(hex.slice(0, 2), 16) / 255;
        const g = parseInt(hex.slice(2, 4), 16) / 255;
        const b = parseInt(hex.slice(4, 6), 16) / 255;
        const a = parseInt(hex.slice(6, 8), 16) / 255;
        return { r, g, b, a };
    }
    // Handle standard hex
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    return { r, g, b };
}
function parseFloatValue(value) {
    // Extract just the number part if there are units
    const match = value.match(/^(-?\d+(\.\d+)?)/);
    if (match) {
        return parseFloat(match[1]);
    }
    return 0;
}
// =============================================
// MAIN PLUGIN INITIALIZATION
// =============================================
// Show the UI with appropriate dimensions for the combined plugin
figma.showUI(__html__, { width: 768, height: 640 });
// Initialize the plugin
(() => __awaiter(void 0, void 0, void 0, function* () {
    // Load required fonts
    yield figma.loadFontAsync({ family: "Inter", style: "Regular" });
    // Initialize export functionality
    const variablesByMode = yield scanVariablesByMode();
    const availableCollections = yield getAvailableCollections();
    // Send the initial data (variables and collections) to the UI for export functionality
    figma.ui.postMessage({
        type: "init-data",
        variables: variablesByMode,
        collections: availableCollections,
    });
}))();
// Handle messages from the UI
figma.ui.onmessage = (msg) => __awaiter(void 0, void 0, void 0, function* () {
    // Handle export functionality messages
    if (msg.type === "create-css") {
        const { selectedRoot, selectedTheme, useCodeSyntax } = msg;
        let cssLines = [];
        // Build the :root block using variables from the selected root collection.
        cssLines.push(":root {");
        const rootVars = yield scanVariablesByMode().then(vars => vars.filter(v => v.collectionId === selectedRoot));
        const rootColl = yield getAvailableCollections().then(colls => colls.find(c => c.id === selectedRoot));
        let defaultModeId = "";
        if (rootColl && rootColl.modes.length > 0) {
            defaultModeId = rootColl.modes[0].modeId;
        }
        rootVars.forEach(variable => {
            const cssName = variable.name.replace(/\s+/g, "-").toLowerCase();
            // New: use codeSyntax when requested.
            let value = "";
            if (useCodeSyntax && variable.codeSyntax) {
                value = variable.codeSyntax;
            }
            else {
                value = defaultModeId ? variable.modeValues[defaultModeId] || "" : "";
                if (value.startsWith("alias:")) {
                    let aliasName = value.slice(6);
                    aliasName = aliasName.replace(/\s+/g, "-").toLowerCase();
                    value = `var(--${aliasName})`;
                }
            }
            cssLines.push(`  --${cssName}: ${value};`);
        });
        cssLines.push("}");
        cssLines.push("");
        // Build the data-theme blocks using variables from the selected theme collection.
        const themeColl = yield getAvailableCollections().then(colls => colls.find(c => c.id === selectedTheme));
        if (themeColl && themeColl.modes.length > 0) {
            const themeVars = yield scanVariablesByMode().then(vars => vars.filter(v => v.collectionId === selectedTheme));
            themeColl.modes.forEach(mode => {
                const themeName = mode.name.replace(/\s+/g, "-").toLowerCase();
                cssLines.push(`[data-theme="${themeName}"] {`);
                themeVars.forEach(variable => {
                    const cssName = variable.name.replace(/\s+/g, "-").toLowerCase();
                    let value = "";
                    if (useCodeSyntax && variable.codeSyntax) {
                        value = variable.codeSyntax;
                    }
                    else {
                        value = variable.modeValues[mode.modeId] || "";
                        if (value.startsWith("alias:")) {
                            let aliasName = value.slice(6);
                            aliasName = aliasName.replace(/\s+/g, "-").toLowerCase();
                            value = `var(--${aliasName})`;
                        }
                    }
                    cssLines.push(`  --${cssName}: ${value};`);
                });
                cssLines.push("}");
                cssLines.push("");
            });
        }
        const cssVariables = cssLines.join("\n");
        figma.ui.postMessage({
            type: "display-css",
            css: cssVariables,
        });
    }
    // Handle import functionality messages
    else if (msg.type === 'parse-css') {
        try {
            const collections = parseCSSVariables(msg.cssText);
            yield createFigmaVariables(collections);
            figma.ui.postMessage({
                type: 'status',
                message: 'Variables created successfully!',
                status: 'success'
            });
            // Refresh the export view with the newly created variables
            const variablesByMode = yield scanVariablesByMode();
            const availableCollections = yield getAvailableCollections();
            figma.ui.postMessage({
                type: "init-data",
                variables: variablesByMode,
                collections: availableCollections,
            });
        }
        catch (error) {
            figma.ui.postMessage({
                type: 'status',
                message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                status: 'error'
            });
        }
    }
    // Handle close plugin message
    else if (msg.type === "close-plugin") {
        figma.closePlugin();
    }
    else if (msg.type === 'reload-plugin') {
        // Re-initialize the plugin
        const variablesByMode = yield scanVariablesByMode();
        const availableCollections = yield getAvailableCollections();
        // Send the refreshed data to the UI
        figma.ui.postMessage({
            type: "init-data",
            variables: variablesByMode,
            collections: availableCollections,
        });
    }
});
