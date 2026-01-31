import { useState, useRef } from 'react';
import { downloadPlan, importPlanFromFile, createNewPlan, type ImportResult } from '../data';
import { Button } from './ui';
import { HelpModal } from './HelpModal';

interface HeaderProps {
  onAddAccount: () => void;
  onShowAssumptions: () => void;
  onShowEvents: () => void;
  onShowSettings: () => void;
  onDataChange?: () => void;
  showEventHighlights: boolean;
  onToggleEventHighlights: () => void;
}

interface ToolbarButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  primary?: boolean;
  tooltip?: string;
}

function ToolbarButton({ icon, label, onClick, active, primary, tooltip }: ToolbarButtonProps) {
  return (
    <button
      onClick={onClick}
      title={tooltip}
      className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded transition-colors min-w-[56px] ${
        primary
          ? 'bg-blue-600 text-white hover:bg-blue-700'
          : active
          ? 'bg-blue-100 text-blue-700'
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
      }`}
    >
      <span className="w-5 h-5">{icon}</span>
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}

function ToolbarDivider() {
  return <div className="w-px h-10 bg-gray-200 mx-1" />;
}

// Icons as simple SVG components
const Icons = {
  new: (
    <svg viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M4.5 2A1.5 1.5 0 003 3.5v13A1.5 1.5 0 004.5 18h11a1.5 1.5 0 001.5-1.5V7.621a1.5 1.5 0 00-.44-1.06l-4.12-4.122A1.5 1.5 0 0011.378 2H4.5zm4.75 6.75a.75.75 0 011.5 0v2.25h2.25a.75.75 0 010 1.5h-2.25v2.25a.75.75 0 01-1.5 0v-2.25H7a.75.75 0 010-1.5h2.25V8.75z" clipRule="evenodd" />
    </svg>
  ),
  open: (
    <svg viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M2 4.75C2 3.784 2.784 3 3.75 3h4.836c.464 0 .909.184 1.237.513l1.414 1.414a.25.25 0 00.177.073h4.836c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0116.25 17H3.75A1.75 1.75 0 012 15.25V4.75z" clipRule="evenodd" />
    </svg>
  ),
  save: (
    <svg viewBox="0 0 20 20" fill="currentColor">
      <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" />
      <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
    </svg>
  ),
  assumptions: (
    <svg viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M4.5 2A2.5 2.5 0 002 4.5v11A2.5 2.5 0 004.5 18h11a2.5 2.5 0 002.5-2.5v-11A2.5 2.5 0 0015.5 2h-11zM5 5.75A.75.75 0 015.75 5h8.5a.75.75 0 010 1.5h-8.5A.75.75 0 015 5.75zm0 4A.75.75 0 015.75 9h8.5a.75.75 0 010 1.5h-8.5A.75.75 0 015 9.75zm0 4a.75.75 0 01.75-.75h4.5a.75.75 0 010 1.5h-4.5a.75.75 0 01-.75-.75z" clipRule="evenodd" />
    </svg>
  ),
  events: (
    <svg viewBox="0 0 20 20" fill="currentColor">
      <path d="M5.25 12a.75.75 0 01.75-.75h.01a.75.75 0 01.75.75v.01a.75.75 0 01-.75.75H6a.75.75 0 01-.75-.75V12zM6 13.25a.75.75 0 00-.75.75v.01c0 .414.336.75.75.75h.01a.75.75 0 00.75-.75V14a.75.75 0 00-.75-.75H6zM7.25 12a.75.75 0 01.75-.75h.01a.75.75 0 01.75.75v.01a.75.75 0 01-.75.75H8a.75.75 0 01-.75-.75V12zM8 13.25a.75.75 0 00-.75.75v.01c0 .414.336.75.75.75h.01a.75.75 0 00.75-.75V14a.75.75 0 00-.75-.75H8zM9.25 10a.75.75 0 01.75-.75h.01a.75.75 0 01.75.75v.01a.75.75 0 01-.75.75H10a.75.75 0 01-.75-.75V10zM10 11.25a.75.75 0 00-.75.75v.01c0 .414.336.75.75.75h.01a.75.75 0 00.75-.75V12a.75.75 0 00-.75-.75H10zM9.25 14a.75.75 0 01.75-.75h.01a.75.75 0 01.75.75v.01a.75.75 0 01-.75.75H10a.75.75 0 01-.75-.75V14zM12 9.25a.75.75 0 00-.75.75v.01c0 .414.336.75.75.75h.01a.75.75 0 00.75-.75V10a.75.75 0 00-.75-.75H12zM11.25 12a.75.75 0 01.75-.75h.01a.75.75 0 01.75.75v.01a.75.75 0 01-.75.75H12a.75.75 0 01-.75-.75V12zM12 13.25a.75.75 0 00-.75.75v.01c0 .414.336.75.75.75h.01a.75.75 0 00.75-.75V14a.75.75 0 00-.75-.75H12zM13.25 10a.75.75 0 01.75-.75h.01a.75.75 0 01.75.75v.01a.75.75 0 01-.75.75H14a.75.75 0 01-.75-.75V10zM14 11.25a.75.75 0 00-.75.75v.01c0 .414.336.75.75.75h.01a.75.75 0 00.75-.75V12a.75.75 0 00-.75-.75H14z" />
      <path fillRule="evenodd" d="M5.75 2a.75.75 0 01.75.75V4h7V2.75a.75.75 0 011.5 0V4h.25A2.75 2.75 0 0118 6.75v8.5A2.75 2.75 0 0115.25 18H4.75A2.75 2.75 0 012 15.25v-8.5A2.75 2.75 0 014.75 4H5V2.75A.75.75 0 015.75 2zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75z" clipRule="evenodd" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M7.84 1.804A1 1 0 018.82 1h2.36a1 1 0 01.98.804l.331 1.652a6.993 6.993 0 011.929 1.115l1.598-.54a1 1 0 011.186.447l1.18 2.044a1 1 0 01-.205 1.251l-1.267 1.113a7.047 7.047 0 010 2.228l1.267 1.113a1 1 0 01.206 1.25l-1.18 2.045a1 1 0 01-1.187.447l-1.598-.54a6.993 6.993 0 01-1.929 1.115l-.33 1.652a1 1 0 01-.98.804H8.82a1 1 0 01-.98-.804l-.331-1.652a6.993 6.993 0 01-1.929-1.115l-1.598.54a1 1 0 01-1.186-.447l-1.18-2.044a1 1 0 01.205-1.251l1.267-1.114a7.05 7.05 0 010-2.227L1.821 7.773a1 1 0 01-.206-1.25l1.18-2.045a1 1 0 011.187-.447l1.598.54A6.993 6.993 0 017.51 3.456l.33-1.652zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
    </svg>
  ),
  addAccount: (
    <svg viewBox="0 0 20 20" fill="currentColor">
      <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
    </svg>
  ),
  eye: (
    <svg viewBox="0 0 20 20" fill="currentColor">
      <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
      <path fillRule="evenodd" d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
    </svg>
  ),
  eyeOff: (
    <svg viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M3.28 2.22a.75.75 0 00-1.06 1.06l14.5 14.5a.75.75 0 101.06-1.06l-1.745-1.745a10.029 10.029 0 003.3-4.38 1.651 1.651 0 000-1.185A10.004 10.004 0 009.999 3a9.956 9.956 0 00-4.744 1.194L3.28 2.22zM7.752 6.69l1.092 1.092a2.5 2.5 0 013.374 3.373l1.091 1.092a4 4 0 00-5.557-5.557z" clipRule="evenodd" />
      <path d="M10.748 13.93l2.523 2.523a9.987 9.987 0 01-3.27.547c-4.258 0-7.894-2.66-9.337-6.41a1.651 1.651 0 010-1.186A10.007 10.007 0 012.839 6.02L6.07 9.252a4 4 0 004.678 4.678z" />
    </svg>
  ),
  help: (
    <svg viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM8.94 6.94a.75.75 0 11-1.061-1.061 3 3 0 112.871 5.026v.345a.75.75 0 01-1.5 0v-.5c0-.72.57-1.172 1.081-1.287A1.5 1.5 0 108.94 6.94zM10 15a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
    </svg>
  ),
};

export function Header({ 
  onAddAccount, 
  onShowAssumptions, 
  onShowEvents, 
  onShowSettings,
  onDataChange,
  showEventHighlights,
  onToggleEventHighlights,
}: HeaderProps) {
  const [importError, setImportError] = useState<string | null>(null);
  const [showConfirmNew, setShowConfirmNew] = useState(false);
  const [showConfirmImport, setShowConfirmImport] = useState(false);
  const [showSaveAs, setShowSaveAs] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [currentPlanName, setCurrentPlanName] = useState<string | null>(null);
  const [saveAsFilename, setSaveAsFilename] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const generateTimestamp = () => {
    const now = new Date();
    return now.toISOString().slice(0, 19).replace(/[T:]/g, '-');
  };

  const generateDefaultFilename = () => {
    const timestamp = generateTimestamp();
    if (currentPlanName) {
      // Remove .json extension if present, add timestamp, re-add .json
      const baseName = currentPlanName.replace(/\.json$/i, '');
      return `${baseName}-${timestamp}.json`;
    }
    return `retirement-plan-${timestamp}.json`;
  };

  const handleSaveClick = () => {
    setSaveAsFilename(generateDefaultFilename());
    setShowSaveAs(true);
  };

  const handleConfirmSave = async () => {
    const filename = saveAsFilename.endsWith('.json') ? saveAsFilename : `${saveAsFilename}.json`;
    setShowSaveAs(false);
    setCurrentPlanName(filename);
    await downloadPlan(filename);
  };

  const handleLoadClick = () => {
    setImportError(null);
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    e.target.value = '';
    setPendingFile(file);
    setShowConfirmImport(true);
  };

  const handleConfirmImport = async () => {
    if (!pendingFile) return;
    
    const filename = pendingFile.name;
    setShowConfirmImport(false);
    const result: ImportResult = await importPlanFromFile(pendingFile);
    setPendingFile(null);
    
    if (!result.success) {
      setImportError(result.error);
      return;
    }
    
    // Track the loaded filename (without timestamp for cleaner re-saves)
    setCurrentPlanName(filename);
    onDataChange?.();
  };

  const handleNewClick = () => {
    setShowConfirmNew(true);
  };

  const handleConfirmNew = async () => {
    setShowConfirmNew(false);
    setCurrentPlanName(null);
    await createNewPlan();
    onDataChange?.();
  };

  return (
    <>
      <header className="bg-white border-b border-gray-200 px-3 py-1.5">
        <div className="flex items-center">
          {/* Logo */}
          <h1 className="text-base font-bold text-gray-900 mr-4">Retirement Planner</h1>
          
          {/* Toolbar */}
          <div className="flex items-center">
            {/* File operations */}
            <ToolbarButton icon={Icons.new} label="New" onClick={handleNewClick} tooltip="Create a new blank plan" />
            <ToolbarButton icon={Icons.open} label="Open" onClick={handleLoadClick} tooltip="Open a plan from file" />
            <ToolbarButton icon={Icons.save} label="Save As" onClick={handleSaveClick} tooltip="Save plan to file" />
            
            <ToolbarDivider />
            
            {/* Configuration */}
            <ToolbarButton icon={Icons.assumptions} label="Assumptions" onClick={onShowAssumptions} tooltip="Define growth assumptions by epoch" />
            <ToolbarButton icon={Icons.settings} label="Settings" onClick={onShowSettings} tooltip="Global settings for people, tax and super" />
            
            <ToolbarDivider />
            
            {/* Events */}
            <ToolbarButton icon={Icons.events} label="Events" onClick={onShowEvents} tooltip="Manage one-time financial events" />
            <ToolbarButton 
              icon={showEventHighlights ? Icons.eye : Icons.eyeOff} 
              label="Highlights" 
              onClick={onToggleEventHighlights}
              active={showEventHighlights}
              tooltip="Show where events occur in the forecast"
            />
            
            <ToolbarDivider />
            
            {/* Primary action */}
            <ToolbarButton icon={Icons.addAccount} label="Account" onClick={onAddAccount} primary tooltip="Add a new account" />
          </div>
          
          {/* Spacer */}
          <div className="flex-1" />
          
          {/* Help */}
          <ToolbarButton icon={Icons.help} label="Help" onClick={() => setShowHelp(true)} tooltip="View help documentation" />
        </div>
        
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleFileSelected}
        />
      </header>

      {/* Import Error Dialog */}
      {importError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Import Failed</h3>
            <p className="text-sm text-red-600 mb-4">{importError}</p>
            <div className="flex justify-end">
              <Button onClick={() => setImportError(null)}>OK</Button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm New Plan Dialog */}
      {showConfirmNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Create New Plan?</h3>
            <p className="text-sm text-gray-600 mb-4">
              This will clear all current data. Make sure to save your current plan first if you want to keep it.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowConfirmNew(false)}>Cancel</Button>
              <Button onClick={handleConfirmNew}>Create New</Button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Import Dialog */}
      {showConfirmImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Open Plan?</h3>
            <p className="text-sm text-gray-600 mb-4">
              This will replace all current data with the contents of "{pendingFile?.name}". 
              Make sure to save your current plan first if you want to keep it.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => { setShowConfirmImport(false); setPendingFile(null); }}>Cancel</Button>
              <Button onClick={handleConfirmImport}>Open</Button>
            </div>
          </div>
        </div>
      )}

      {/* Save As Dialog */}
      {showSaveAs && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Save Plan As</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Filename
              </label>
              <input
                type="text"
                value={saveAsFilename}
                onChange={(e) => setSaveAsFilename(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConfirmSave();
                  if (e.key === 'Escape') setShowSaveAs(false);
                }}
              />
              <p className="text-xs text-gray-500 mt-1">
                .json extension will be added if not present
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowSaveAs(false)}>Cancel</Button>
              <Button onClick={handleConfirmSave}>Save</Button>
            </div>
          </div>
        </div>
      )}

      {/* Help Modal */}
      <HelpModal isOpen={showHelp} onClose={() => setShowHelp(false)} />
    </>
  );
}
