"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
// Show the plugin UI
figma.showUI(__html__, { width: 400, height: 450 });
// Variable to store the selected component
let selectedComponent = null;
// Listen for messages from the UI
figma.ui.onmessage = (msg) => __awaiter(void 0, void 0, void 0, function* () {
    // Handle component selection request
    if (msg.type === 'select-component') {
        // Reset current selection
        selectedComponent = null;
        // Prompt the user to select a component
        figma.notify("Please select a component");
        // Set up a listener for selection changes
        const selectionChange = figma.on('selectionchange', () => {
            const selectedNodes = figma.currentPage.selection;
            // Check if exactly one node is selected
            if (selectedNodes.length === 1) {
                const node = selectedNodes[0];
                // Check if the selected node is a component
                if (node.type === 'COMPONENT') {
                    // Store the selected component
                    selectedComponent = node;
                    // Send the component info to the UI
                    figma.ui.postMessage({
                        type: 'component-selected',
                        id: node.id,
                        key: node.key,
                        name: node.name
                    });
                    // Remove the listener after successful selection
                    figma.off('selectionchange', selectionChange);
                }
                else {
                    figma.notify("Please select a component (not an instance or other object)");
                }
            }
            else if (selectedNodes.length > 1) {
                figma.notify("Please select only one component");
            }
        });
    }
    // Handle search request with real API call
    if (msg.type === 'find-usage') {
        if (!selectedComponent) {
            figma.ui.postMessage({
                type: 'error',
                message: 'No component selected'
            });
            return;
        }
        try {
            // For now, we'll use a dummy access token. In Step 3, we'll implement proper authentication
            const accessToken = 'dummy_token';
            // Get team ID (this will be null if not in a team)
            const teamId = figma.team ? figma.team.id : 'dummy_team_id';
            // Get current project ID (optional)
            const projectId = figma.currentPage.parent ? figma.currentPage.parent.id : null;
            // Call to your server
            const response = yield fetch('http://localhost:3000/api/find-usage', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessToken}`
                },
                body: JSON.stringify({
                    componentKey: selectedComponent.key,
                    teamId: teamId,
                    projectId: projectId
                })
            });
            if (!response.ok) {
                throw new Error(`Server responded with ${response.status}`);
            }
            const results = yield response.json();
            figma.ui.postMessage({
                type: 'search-results',
                results: results
            });
        }
        catch (error) {
            figma.ui.postMessage({
                type: 'error',
                message: error.message || 'Failed to find component usage'
            });
        }
    }
});
