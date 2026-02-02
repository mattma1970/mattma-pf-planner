# PF Assistant: Natural Language Retirement Planner

**Version:** 0.1 (Draft)
**Last Updated:** 2026-02-02
**Status:** Planning

---

## 1. Vision

Transform the Retirement Financial Planner from a purely UI-driven application into a hybrid experience where users can accomplish any task through natural language conversation with an AI assistant. The assistant should understand financial planning concepts, make reasonable assumptions when needed, and execute complex multi-step operations that would otherwise require many clicks across multiple UI screens.

### Core Goals

| Goal | Description |
|------|-------------|
| **Parity with UI** | Assistant can perform any action available through the UI |
| **Proactive Intelligence** | Assistant makes reasonable assumptions and suggests actions |
| **Transparency** | Users see exactly what the assistant is doing |
| **Safety** | Guardrails prevent destructive actions without confirmation |
| **Context Awareness** | Assistant understands current state and builds on it |
| **Multi-Step Operations** | Assistant chains multiple actions to achieve complex goals |

### Example Conversations

**Scenario Analysis:**
```
User: "What happens if there's a market downturn in 2030 that lasts 4 years?"
Assistant: I'll create a scenario with a 4-year market downturn. Based on historical recessions, I'll assume:
  - Super returns: -15% in 2030, -8% in 2031, -3% in 2032, +2% recovery in 2033
  - Investment returns: -20%, -10%, -5%, +5%
  - Reverts to base assumptions (7%) from 2034

Should I create this scenario and run the forecast?
User: Yes, and also show me how it compares to my base case.
```

**Account Management:**
```
User: "Add an investment property worth $850,000 I plan to buy in 2028"
Assistant: I'll add an investment property asset. A few questions:
  1. Will you have a mortgage? (e.g., 80% LVR)
  2. What rental income do you expect? (I can assume 3-5% yield if you're unsure)
  3. What are ongoing costs? (I'll include property management, insurance, maintenance)

User: 80% mortgage at 6%, 4% rental yield, 2% annual costs
Assistant: I've created:
  - Asset: Investment Property ($850K, 4% growth)
  - Liability: Mortgage ($680K, 6% interest, interest-only 5 years then principal)
  - Income: Rental Income ($34K/year, CPI-indexed)
  - Expense: Property Costs ($17K/year, 2% of value, CPI-indexed)

The mortgage is funded from your "Cash" account. Want to adjust anything?
```

**Complex Analysis:**
```
User: "Show me when I can retire if I want $80K/year in today's dollars, and what happens if I work 2 more years"
Assistant: I'll analyze your retirement readiness based on your current forecast.

Your current forecast (retiring at 65):
  - Sustainable drawdown: $68K/year (in today's dollars)
  - To reach $80K/year, you'd need an additional $320K by retirement

If you work until 67:
  - Sustainable drawdown: $76K/year (in today's dollars)
  - Gap to $80K/year: $80K remaining

Options to reach $80K/year:
  1. Increase super contributions by $8K/year (salary sacrifice)
  2. Work until 68 with current savings rate
  3. Reduce investment risk (currently 80% growth assets)

Want me to create scenarios for any of these options?
```

---

## 2. Architecture Overview

The PF Assistant architecture builds on the existing Actions Layer, making every UI action available to the AI through function calling.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Browser                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Chat UI (React)                                                │   │
│  │  - Message list with user/AI turns                               │   │
│  │  - Input area with suggestions                                   │   │
│  │  - Tool call visualization (showing what AI is doing)             │   │
│  └────────────────┬─────────────────────────────────────────────────┘   │
│                   │                                                    │
│                   ▼                                                    │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  AI Client (Vercel AI SDK + Custom Local Adapter)                 │   │
│  │  - Manages LLM conversation state                                │   │
│  │  - Handles tool/function calling                                 │   │
│  │  - Streams responses to UI                                      │   │
│  │  - Supports: OpenAI, Anthropic, Local (Ollama, vLLM)          │   │
│  └────────────────┬─────────────────────────────────────────────────┘   │
│                   │                                                    │
│                   ▼                                                    │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Context Builder                                               │   │
│  │  - Gathers current state (accounts, forecast, settings)           │   │
│  │  - Formats for LLM consumption                                  │   │
│  │  - Manages token budget (summarization when needed)             │   │
│  └────────────────┬─────────────────────────────────────────────────┘   │
│                   │                                                    │
│  ┌───────────────┴───────────────┐                                    │
│  │                               │                                    │
│  ▼                               ▼                                    │
│  ┌─────────────────┐       ┌─────────────────┐                          │
│  │  Actions Layer │       │  Query Layer    │   (Future)                │
│  │  (Existing)    │       │  (New)          │                          │
│  │  - accounts    │       │  - analyze      │                          │
│  │  - events      │       │  - summarize    │                          │
│  │  - epochs      │       │  - compare      │                          │
│  │  - forecast    │       │  - suggest      │                          │
│  └────────┬────────┘       └─────────────────┘                          │
│           │                                                          │
│           ▼                                                          │
│  ┌─────────────────┐                                                    │
│  │  Engine Layer  │                                                    │
│  │  (Existing)    │                                                    │
│  └────────┬────────┘                                                    │
│           │                                                          │
│           ▼                                                          │
│  ┌─────────────────┐                                                    │
│  │  Data Layer    │                                                    │
│  │  (IndexedDB)   │                                                    │
│  └─────────────────┘                                                    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTPS (Optional)
                               ▼
 ┌─────────────────────────────────────────────────────────────────────────┐
 │  Backend API (Future Phase)                                            │
 ├─────────────────────────────────────────────────────────────────────────┤
 │  - Cloud storage (optional alternative to IndexedDB)                         │
 │  - User authentication                                                  │
 │  - LLM API key management (convenience feature)                          │
 └─────────────────────────────────────────────────────────────────────────┘
```

### Key Architectural Decisions

#### 2.1 Client-First (Phase 1)

**Why:** The app is designed to work offline with IndexedDB. Running the AI client-side maintains this property.

**Trade-offs:**
- ✅ No backend required
- ✅ Data never leaves user's device
- ✅ Works offline (except AI calls)
- ❌ LLM API keys must be stored in client (user provides their own)
- ❌ No server-side optimization/caching

#### 2.2 Function Calling over Prompt Injection

**Why:** The existing Actions Layer is designed for LLM integration. Each action has clear parameters (via Zod schemas) and can be exposed as tools.

**Approach:**
```typescript
// actions/tools/index.ts
import { z } from 'zod';

// Define tool schemas (can be auto-generated from action params)
export const tools = {
  createAccount: {
    description: 'Create a new financial account (income, expense, asset, or liability)',
    parameters: AccountInputSchema,
    handler: createAccount,
  },
  
  updateAccount: {
    description: 'Update an existing account',
    parameters: z.object({
      id: z.string().describe('The account ID to update'),
      updates: z.object({ /* partial account fields */ }),
    }),
    handler: updateAccount,
  },
  
  runForecast: {
    description: 'Run the retirement forecast calculation',
    parameters: z.object({
      startYear: z.number(),
      endYear: z.number(),
    }),
    handler: runForecast,
  },
  
  // ... all other actions
};

// Export as JSON Schema for Vercel AI SDK
export function getToolSchemas() {
  return Object.entries(tools).map(([name, tool]) => ({
    name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}
```

#### 2.3 Context Management

The AI needs context about the current state to make informed decisions. We'll build a context layer that:

1. **Summarizes current state**: Instead of dumping all account data, provide high-level summaries
2. **Identifies gaps**: What information is missing to answer the user's request
3. **Tracks conversation**: Maintains recent turns for continuity

```typescript
// ai/context/builder.ts
export interface AIContext {
  summary: {
    persons: PersonSummary[];
    accounts: AccountSummary[];
    epochs: EpochSummary[];
    currentForecast?: ForecastSummary;
  };
  recentActions: ActionSummary[];
  userPreferences: UserPreferences;
  missingInfo: string[];
}

export async function buildContext(limitTokens: number = 8000): Promise<AIContext> {
  const [persons, accounts, epochs, forecast, settings] = await Promise.all([
    repository.getPersons(),
    repository.getAccounts(),
    repository.getEpochs(),
    getLatestForecast(),
    repository.getSettings(),
  ]);

  return {
    summary: summarizeState(persons, accounts, epochs, forecast),
    recentActions: await getRecentActions(),
    userPreferences: settings.aiPreferences ?? {},
    missingInfo: identifyGaps(accounts, epochs),
  };
}
```

#### 2.4 Tool Call Visualization

Users must see exactly what the AI is doing. Every tool call is displayed in the chat:

```
User: "Add a property I'm buying next year for $1.2M"
Assistant: [Thinking...] 

🔧 Creating account "Investment Property"...
   - Type: Asset
   - Initial value: $1,200,000
   - Start year: 2026

🔧 Creating account "Mortgage"...
   - Type: Liability
   - Initial value: $960,000
   - Interest rate: 6.5%

❓ I need a few more details:
   1. Which account will fund the deposit?
   2. What rental income do you expect?
```

---

## 3. Action Layer Expansion

The existing Actions Layer is well-structured for LLM integration. We'll:

### 3.1 Document Every Action

Each action needs:
- Clear description for LLM
- Parameter descriptions (via Zod schemas)
- Examples of typical usage

```typescript
// actions/accounts.ts (enhanced)
/**
 * Create a new financial account.
 * 
 * Use this when the user wants to add a new income source, expense, asset, or liability.
 * 
 * Examples:
 * - "I'm getting a salary of $100K" → createAccount({ type: 'income', name: 'Salary', ... })
 * - "I have $50K in savings" → createAccount({ type: 'asset', name: 'Cash', initialValue: 50000, ... })
 * - "My mortgage is $400K" → createAccount({ type: 'liability', name: 'Mortgage', initialValue: 400000, ... })
 */
export async function createAccount(data: Omit<AccountInput, 'id'>): Promise<Account> {
  // ... existing implementation
}
```

### 3.2 Add Query/Analysis Actions (New Layer)

The current Actions Layer only does CRUD + forecast. We need a Query Layer for "read and analyze" operations:

```typescript
// actions/queries/index.ts

/**
 * Get a summary of the current financial position.
 */
export async function summarizeFinancialPosition(): Promise<FinancialSummary> {
  const [accounts, forecast] = await Promise.all([
    repository.getAccounts(),
    getLatestForecast(),
  ]);

  return {
    netWorth: calculateNetWorth(accounts),
    monthlyCashFlow: calculateMonthlyCashFlow(forecast),
    assetAllocation: calculateAssetAllocation(accounts),
    retirementReadiness: assessRetirementReadiness(forecast),
  };
}

/**
 * Find the best account to fund a purchase.
 */
export async function findFundingAccount(
  amount: number,
  preferredAccountId?: string
): Promise<{ accountId: string; confidence: number; reason: string }> {
  const accounts = await repository.getAccounts();
  const cashAccounts = accounts.filter(a => a.type === 'asset' && a.assetSubType === 'cash');
  
  // Logic: prefer cash accounts, then high-balance assets, consider tax implications
  // ...
}

/**
 * Compare multiple scenarios and return key differences.
 */
export async function compareScenarios(scenarioIds: string[]): Promise<ScenarioComparison> {
  const results = await Promise.all(
    scenarioIds.map(id => runScenarioForecast(id))
  );
  
  return {
    netWorthComparison: results.map(r => ({ scenarioId: r.scenarioId, finalNetWorth: r.finalNetWorth })),
    depletionYears: results.map(r => ({ scenarioId: r.scenarioId, yearDepleted: r.yearDepleted })),
    keyDifferences: identifyKeyDifferences(results),
  };
}

/**
 * Suggest reasonable assumptions for a financial item.
 * Returns educated guesses based on Australian averages and current state.
 */
export async function suggestAssumptions(
  accountType: 'investment' | 'property' | 'super' | 'rental'
): Promise<AssumptionSuggestion> {
  const suggestions = {
    investment: {
      growthRate: { low: 0.05, median: 0.07, high: 0.09 },
      riskLevel: 'medium',
      allocation: { growth: 0.7, defensive: 0.3 },
    },
    property: {
      growthRate: { low: 0.02, median: 0.04, high: 0.06 },
      rentalYield: { low: 0.03, median: 0.045, high: 0.06 },
      maintenanceCost: 0.01, // 1% of value annually
    },
    // ... other types
  };

  return suggestions[accountType];
}
```

### 3.3 Add Validation Actions

Before making changes, the AI should validate them:

```typescript
// actions/validation.ts

/**
 * Check if a proposed change is safe and won't break things.
 */
export async function validateChanges(
  changes: ProposedChange[]
): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];
  
  for (const change of changes) {
    if (change.type === 'deleteAccount') {
      const references = await findAccountReferences(change.accountId);
      if (references.length > 0) {
        issues.push({
          severity: 'error',
          message: `Account is referenced by ${references.length} other items`,
          details: references,
        });
      }
    }
    
    // ... other validations
  }

  return {
    valid: issues.filter(i => i.severity === 'error').length === 0,
    issues,
    warnings: issues.filter(i => i.severity === 'warning'),
  };
}
```

---

## 4. Conversation Design

### 4.1 Turn Structure

Each conversation turn includes:

```typescript
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  timestamp: Date;
}

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
  status: 'pending' | 'success' | 'error';
  result?: any;
  error?: string;
}
```

### 4.2 System Prompt

The system prompt establishes the AI's persona and capabilities:

```
You are a retirement planning assistant for Australian users. You help users:
1. Understand their current financial position
2. Model "what if" scenarios
3. Make informed decisions about retirement planning

You have access to tools that can:
- Create/update/delete accounts (income, expenses, assets, liabilities)
- Run forecasts and analyze results
- Create and compare scenarios
- Set assumptions and epochs

Your approach:
1. Ask clarifying questions when information is missing
2. Make reasonable assumptions based on Australian averages when appropriate
3. Explain what you're doing before making changes
4. Suggest multiple options for complex decisions
5. Validate changes before applying them

Australian context:
- Superannuation is the primary retirement savings vehicle
- Preservation age is typically 60-67 depending on birth year
- Concessional cap is $30,000/year
- Marginal tax rates: 0%, 19%, 32.5%, 37%, 45%
- Capital gains tax: 50% discount for assets held >12 months

When suggesting assumptions:
- Investment returns: Use 7% as baseline, explain uncertainty
- Property growth: Use 3-4% for residential
- Inflation: Use 3% CPI unless otherwise specified
- Always explain assumptions and offer to adjust
```

### 4.3 Clarification Questions

The AI should proactively ask for missing information rather than making assumptions that might be wrong:

```
User: "Add an investment property"
Assistant: I'd like to add an investment property. A few quick questions:

1. **Value**: How much are you planning to spend? (e.g., $800K)
2. **Funding**: Will you pay cash or get a mortgage? If mortgage, what's the LVR?
3. **Rental income**: What yield are you expecting? (I can assume 3-5% if you're unsure)
4. **Timing**: When are you buying it?

You can answer all at once or I can use reasonable defaults:
- $800K value, 80% mortgage at 6.5%, 4% rental yield, buying next year
```

### 4.4 Confirmation for Destructive Actions

Certain actions should require explicit confirmation:

```typescript
const DestructiveActions = {
  deleteAccount: true,
  deleteEvent: true,
  deleteScenario: true,
  resetAllData: true,
};

async function executeToolCall(toolCall: ToolCall): Promise<ToolResult> {
  if (DestructiveActions[toolCall.name]) {
    const confirmed = await requestConfirmation(toolCall);
    if (!confirmed) {
      return { status: 'cancelled', message: 'Action cancelled by user' };
    }
  }
  
  // Execute the tool
  const handler = tools[toolCall.name].handler;
  return await handler(toolCall.arguments);
}
```

---

## 5. UI Components

### 5.1 Chat Interface

```typescript
// components/chat/ChatPanel.tsx

export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);

  return (
    <div className="chat-panel">
      <MessageList messages={messages} />
      <InputArea onSend={handleSend} />
      {isThinking && <ThinkingIndicator />}
    </div>
  );
}

function MessageList({ messages }: { messages: ChatMessage[] }) {
  return (
    <div className="message-list">
      {messages.map((msg) => (
        <Message key={msg.id} message={msg} />
      ))}
    </div>
  );
}

function Message({ message }: { message: ChatMessage }) {
  return (
    <div className={`message message-${message.role}`}>
      <div className="message-content">{message.content}</div>
      
      {message.toolCalls && (
        <ToolCallList toolCalls={message.toolCalls} />
      )}
    </div>
  );
}

function ToolCallList({ toolCalls }: { toolCalls: ToolCall[] }) {
  return (
    <div className="tool-calls">
      {toolCalls.map((call) => (
        <ToolCall key={call.id} call={call} />
      ))}
    </div>
  );
}

function ToolCall({ call }: { call: ToolCall }) {
  return (
    <div className={`tool-call tool-call-${call.status}`}>
      <div className="tool-call-header">
        <Icon name={call.name} />
        <span className="tool-call-name">{formatToolName(call.name)}</span>
        <span className="tool-call-status">{call.status}</span>
      </div>
      
      <Collapsible>
        <ToolArguments args={call.arguments} />
        {call.result && <ToolResult result={call.result} />}
        {call.error && <ToolError error={call.error} />}
      </Collapsible>
    </div>
  );
}
```

### 5.2 Input Suggestions

To help users discover capabilities:

```typescript
// components/chat/InputSuggestions.tsx

const SUGGESTIONS = [
  "What's my net worth at retirement?",
  "Create a scenario with a market downturn",
  "Add an investment property",
  "When can I retire with $80K/year?",
  "Show me tax paid over time",
];

export function InputSuggestions({ onSelect }: { onSelect: (text: string) => void }) {
  return (
    <div className="suggestions">
      {SUGGESTIONS.map((suggestion) => (
        <button
          key={suggestion}
          className="suggestion-chip"
          onClick={() => onSelect(suggestion)}
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
}
```

### 5.3 State Sync

When the AI modifies data, the UI should reflect changes immediately:

```typescript
// hooks/useAIStateSync.ts

export function useAIStateSync() {
  const refreshAccounts = useAccountsStore(s => s.refresh);
  const refreshForecast = useForecastStore(s => s.refresh);
  
  useEffect(() => {
    // Subscribe to tool completion events
    const unsubscribe = subscribeToToolComplete((event) => {
      if (event.toolName.includes('Account')) {
        refreshAccounts();
      }
      if (event.toolName.includes('Forecast') || event.toolName.includes('Scenario')) {
        refreshForecast();
      }
    });
    
    return unsubscribe;
  }, []);
}
```

---

## 6. Backend Integration & Cloud Storage (Future Phase)

### 6.1 Storage Architecture: Local-First with Optional Cloud

The app initially ships with **local-only storage** (IndexedDB). Future versions will offer **cloud storage** as an optional mode. Users choose ONE storage mode - no sync or real-time collaboration required.

**Storage Modes:**

| Mode | Storage | Auth | Offline | Data Location | AI Options |
|-------|----------|-------|---------|---------------|-------------|
| **Local** (Current) | IndexedDB | None | ✅ Works fully offline | Local (Ollama) OR Cloud (OpenAI API key) |
| **Cloud** (Future) | Supabase | Required | ❌ Requires internet | Local OR Cloud API keys (server-managed) |

**Key Design Principle: Quarantined, Not Synced**

Users choose local OR cloud storage at plan creation. Modes are separate:
- Local plans exist only in browser
- Cloud plans exist only in database
- No automatic sync between them
- Users can export/import to move between modes

**Benefits:**
- **No sync complexity** - Avoids conflict resolution, merge logic
- **Clear user mental model** - "Browser-only" vs "Online account" is intuitive
- **Privacy choice** - Users who want zero data leaving device stay in local mode
- **Simple migration** - Repository pattern makes storage layer swappable

---

### 6.2 When to Add Backend?

**Backend should be added when:**
- Users request multi-device access ("How do I use this on my phone?")
- Product-market fit validated with local mode
- Ready to invest in auth, database, and infrastructure
- Want to offer premium features tied to cloud storage

**Backend will provide:**

| Feature | Description |
|---------|-------------|
| **Cloud storage mode** | Alternative to IndexedDB for data persistence |
| **Authentication** | User accounts for cloud mode only |
| **LLM key management** | Server-stored keys for cloud API calls (convenience) |
| **Multi-device access** | Access cloud plans from any device |
| **Data export/import** | Move between local and cloud modes |
| **Not included** | Real-time collaboration, sync between modes |

---

```
┌─────────────────────────────────────────────────────────────┐
│                      User                          │
├─────────────────────────────────────────────────────────────┤
│                                                     │
│  ┌─────────────────┐        ┌─────────────────┐  │
│  │   Local Mode   │        │   Cloud Mode   │  │
│  │   (Phase 1)   │        │   (Future)     │  │
│  └────────┬────────┘        └────────┬────────┘  │
│           │                         │            │
│           │ Repository Pattern     │            │
│           └────────┬────────────┘            │
│                    │                         │
│           ┌────────┴────────┐             │
│           │                 │             │
│     ┌─────▼─────┐   ┌─────▼──────┐  │
│     │ IndexedDB   │   │ Supabase   │  │
│     │ Repository  │   │ Repository  │  │
│     └─────┬─────┘   └─────┬──────┘  │
│           │                 │            │
│           └────────┬────────┘            │
│                    ▼                    │
│         ┌───────────────┐            │
│         │ Same Business │            │
│         │   Logic      │            │
│         │ (Actions,    │            │
│         │   Engine)    │            │
│         └───────────────┘            │
└─────────────────────────────────────────┘

Local Mode User Flow:
  Browser → IndexedDB → Actions → Engine → Forecast

Cloud Mode User Flow:
  Browser → Auth → Supabase → Actions → Engine → Forecast
                                    ↓
                              Server API (optional, for key management)
```

---

### 6.3 Migration Paths Between Modes

When users want to move between local and cloud storage:

**Option A: Manual Export/Import (Always available)**
```
1. In local mode: Settings → Export Plan → Download JSON
2. Create cloud account (if not exists)
3. In cloud mode: Settings → Import Plan → Upload JSON
4. Data is now in cloud, local copy remains separate
```

**Option B: One-Time Migration (Cloud Mode feature)**
```
1. User: "Move my plan to cloud"
2. App: Uploads entire local state to Supabase
3. App: Prompts to delete local copy (optional)
4. Switch to cloud mode automatically
```

**Option C: Maintain Separate Plans**
```
User can have:
- "Retirement - Local" (IndexedDB, works offline)
- "Retirement - Cloud" (Supabase, requires internet)

No sync, no confusion. Users explicitly switch between them.
```

**Technical implementation:**
```typescript
// app/init.ts

export async function initializeApp() {
  const storageMode = await getStoragePreference();
  
  const repository: DataRepository = storageMode === 'local'
    ? new IndexedDBRepository()
    : new SupabaseRepository();
  
  // Same business logic for both modes
  const actions = createActions(repository);
  
  // UI unaware of storage implementation
  return { repository, actions };
}

// In settings:
function SettingsPanel() {
  const [mode, setMode] = useState<'local' | 'cloud'>('local');
  
  const handleSwitchMode = async () => {
    if (mode === 'local' && confirm('Switch to cloud? Data will be moved to Supabase.')) {
      await migrateToCloud();
      setMode('cloud');
    } else if (mode === 'cloud' && confirm('Switch to local? Data will be exported.')) {
      await exportToLocal();
      setMode('local');
    }
  };
  
  return (
    <div>
      <label>
        <input type="radio" value="local" checked={mode === 'local'} onChange={setMode} />
        Local Storage (browser only, private)
      </label>
      <label>
        <input type="radio" value="cloud" checked={mode === 'cloud'} onChange={setMode} />
        Cloud Storage (account required, accessible anywhere)
      </label>
      <button onClick={handleSwitchMode}>Switch Mode</button>
    </div>
  );
}
```

**Data format compatibility:**
- Both modes use identical schemas (Zod)
- JSON export/import works across modes
- No data loss during migration
- Migration is one-directional (local → cloud) typically

---

### 6.4 Storage × LLM Provider Matrix

**Important:** Storage mode (local/cloud) and LLM provider are **independent choices**:

```
Storage Mode × LLM Provider = 4 Valid Combinations:

                    │  Local AI      │  Cloud AI
                    │  (Ollama/vLLM) │  (OpenAI/Anthropic)
────────────────────────┼──────────────────┼──────────────────
Local Storage      │  ✅ Complete   │  ✅ Works
(IndexedDB)          │     offline,     │     offline
                      │     zero data   │     (uses
                      │     leaves     │      user's
                      │     device     │      API key)
────────────────────────┼──────────────────┼──────────────────
Cloud Storage       │  ❌ Requires  │  ✅ Complete
(Supabase)          │     internet   │     offline
                      │     to access  │     (uses
                      │     Supabase    │      server
                      │                │      keys)
                      │                │      but stores
                      │                │      data)
```

**Note:** Local AI with cloud storage still requires internet to access Supabase, but AI processing happens locally.

---

### 6.5 Repository Pattern Enables Clean Migration

The repository abstraction ensures business logic (Actions, Engine) is **storage-agnostic**:

```typescript
// Both repositories implement same interface:
interface DataRepository {
  getAccounts(): Promise<Account[]>;
  saveAccount(account: Account): Promise<void>;
  // ... all CRUD operations
}

// Local mode implementation:
class IndexedDBRepository implements DataRepository {
  async getAccounts(): Promise<Account[]> {
    return await db.accounts.toArray();
  }
  // ... IndexedDB operations
}

// Cloud mode implementation:
class SupabaseRepository implements DataRepository {
  async getAccounts(): Promise<Account[]> {
    const user = await getUser();
    const { data, error } = await supabase
      .from('accounts')
      .select('*')
      .eq('user_id', user.id);
    return data || [];
  }
  // ... Supabase operations
}

// Business logic unchanged:
async function createAccount(data: Omit<AccountInput, 'id'>): Promise<Account> {
  // Works with EITHER repository:
  const account = AccountSchema.parse({ ...data, id: uuidv4() });
  await repository.saveAccount(account);  // ← Calls IndexedDB or Supabase
  return account;
}
```

**Migration timeline:**

| Phase | Storage | LLM | Features |
|-------|----------|-------|-----------|
| **Phase 1** (Current) | IndexedDB only | Local (Ollama) OR Cloud APIs (user's key) | Full feature set, AI assistant, local model support |
| **Phase 2** (Future) | Add Supabase option | Same as Phase 1 | Cloud storage mode, auth, multi-device access |
| **Phase 3** (Future) | Local + Cloud | Add server-side key management | Convenience features, premium tier |

**Phase 2+ implementation:**
- Add `SupabaseRepository` implementation
- Add authentication flows (email/password, OAuth)
- Add storage mode selection UI
- Add export/import utilities for cross-mode migration
- **No changes** to Actions, Engine, or AI client logic

---

### 6.6 LLM Integration Across All Modes

**Goal:** Support client-side API keys, server-side keys (cloud mode), and local models - all independent of storage choice.

**Implementation:**
```typescript
// ai/client/adapter.ts

type LLMProvider = 'client' | 'server' | 'local';
type StorageMode = 'local' | 'cloud';

interface LLMConfig {
  provider: LLMProvider;
  apiKey?: string; // For 'client' provider
  localConfig?: LocalLLMConfig; // For 'local' provider
  // No config needed for 'server' - backend handles it
}

export async function chatWithAI(
  messages: ChatMessage[],
  config: LLMConfig,
  storageMode: StorageMode
): Promise<ChatMessage> {
  
  // Choose AI provider independently of storage mode
  switch (config.provider) {
    case 'client':
      // User's OpenAI/Anthropic API key
      return await clientSideChat(messages, config.apiKey);
      
    case 'local':
      // Ollama, vLLM, etc. running on user's machine
      return await localChat(messages, config.localConfig);
      
    case 'server':
      // Backend handles LLM calls (cloud storage mode only)
      if (storageMode === 'local') {
        throw new Error('Server AI requires cloud storage mode');
      }
      return await serverSideChat(messages);
  }
}
```

**User configuration flow:**
```tsx
function AIProviderSettings() {
  const [llmProvider, setLLMProvider] = useState<LLMProvider>('local');
  const [storageMode, setStorageMode] = useState<StorageMode>('local');
  
  return (
    <div>
      <h3>Storage (Where is data saved?)</h3>
      <StorageModeSelector value={storageMode} onChange={setStorageMode} />
      
      <h3>AI Provider (Who processes requests?)</h3>
      <LLMProviderSelector value={llmProvider} onChange={setLLMProvider} />
      
      {llmProvider === 'client' && <APIKeyInput provider="openai|anthropic" />}
      {llmProvider === 'local' && <LocalModelConfig />}
      {llmProvider === 'server' && <p>Managed by backend (cloud mode only)</p>}
    </div>
  );
}
```

**Key advantage:** Storage and AI provider are orthogonal concerns. User can:
- Run local AI with local storage (most private option)
- Run cloud AI with cloud storage (most convenient option)
- Run local AI with cloud storage (balance of privacy + multi-device)
- Run cloud AI with local storage (hybrid approach)

---

## 7. Local Model Support (Bring Your Own Model)

**Goal:** Enable users to run their own LLMs locally via Ollama, vLLM, or compatible inference servers, offering complete privacy and control.

#### Why Local Models?

| Benefit | Description |
|---------|-------------|
| **Privacy** | No data leaves your device - all AI processing happens locally |
| **Cost** | No API fees after hardware investment; free to run |
| **Customization** | Fine-tune models on your own financial data |
| **Offline** | Full functionality without internet connection |
| **Control** | Choose exactly which model and parameters to use |

#### Supported Local Providers

| Provider | Description | Models |
|----------|-------------|---------|
| **Ollama** | Easy-to-use CLI for running LLMs locally | Llama 3.x, Mistral, Codestral, Qwen, Gemma, etc. |
| **vLLM** | High-performance serving for production workloads | Any HuggingFace model with quantization support |
| **LM Studio** | GUI-based local LLM runner with API server | Download models from built-in marketplace |
| **OpenAI-Compatible APIs** | Any server following OpenAI API spec | Custom finetunes, other inference servers |

#### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Browser / Client                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Chat UI & AI Client                                   │  │
│  └────────────────┬───────────────────────────────────────────┘  │
│                   │                                              │
│                   ▼                                              │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  LLM Provider Selector                                   │  │
│  │  - OpenAI API (Client Keys)                             │  │
│  │  - Anthropic API (Client Keys)                           │  │
│  │  - Backend API (Future)                                  │  │
│  │  - Local Provider ← Selected                             │  │
│  └────────────────┬───────────────────────────────────────────┘  │
│                   │                                              │
│                   ▼                                              │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Local LLM Adapter                                     │  │
│  │  - Detects provider (Ollama, vLLM, etc.)               │  │
│  │  - Maps tools to OpenAI-compatible format                 │  │
│  │  - Handles streaming responses                           │  │
│  │  - Manages connection health                             │  │
│  └────────────────┬───────────────────────────────────────────┘  │
│                   │                                              │
│                   ▼                                              │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  HTTP Request to Local Endpoint                          │  │
│  │  (localhost:11434 for Ollama, or custom URL)           │  │
│  └────────────────────────────────────────────────────────────┘  │
└─────────────────────────┬────────────────────────────────────────┘
                          │
                          │ HTTP/JSON
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  Local Inference Server                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │   Ollama    │  │   vLLM      │  │   Other     │          │
│  │  (Models    │  │  (High      │  │  (Custom    │          │
│  │   on disk)  │  │   perf)     │  │   API)      │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
│         │               │               │                           │
│         └───────────────┴───────────────┘                           │
│                         │                                       │
│                         ▼                                       │
│                  ┌─────────────┐                                  │
│                  │   GPU/CPU  │  (Your hardware)                 │
│                  └─────────────┘                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### Implementation

```typescript
// ai/local/adapter.ts

export interface LocalLLMConfig {
  provider: 'ollama' | 'vllm' | 'custom';
  baseUrl: string;  // e.g., 'http://localhost:11434/v1'
  model: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Chat with a locally-hosted LLM using OpenAI-compatible API format.
 * Most local providers (Ollama, vLLM, LM Studio) support this format.
 */
export async function localChat(
  messages: ChatMessage[],
  config: LocalLLMConfig
): Promise<ChatMessage> {
  // Build system prompt with tools
  const systemPrompt = buildSystemPrompt(messages[0]);
  const chatMessages = formatMessagesForAPI(messages);

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...chatMessages,
        ],
        tools: getToolSchemas(),  // OpenAI tool format
        tool_choice: 'auto',
        temperature: config.temperature ?? 0.7,
        max_tokens: config.maxTokens ?? 4096,
        stream: true,  // Enable streaming
      }),
    });

    if (!response.ok) {
      throw new Error(`Local LLM error: ${response.statusText}`);
    }

    // Handle streaming response
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    
    return await processStream(reader, decoder);
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
      throw new Error(
        'Cannot connect to local LLM. Please ensure your local server is running. ' +
        `Expected endpoint: ${config.baseUrl}`
      );
    }
    throw error;
  }
}

/**
 * Process SSE (Server-Sent Events) stream from local LLM.
 * Both Ollama and vLLM use OpenAI-compatible streaming format.
 */
async function processStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder
): Promise<ChatMessage> {
  let accumulatedContent = '';
  let toolCalls: ToolCall[] = [];
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');
    
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      
      const data = line.slice(6);
      if (data === '[DONE]') continue;
      
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices[0]?.delta;
        
        // Stream content
        if (delta?.content) {
          accumulatedContent += delta.content;
          // UI can update in real-time
        }
        
        // Stream tool calls
        if (delta?.tool_calls) {
          toolCalls = mergeToolCalls(toolCalls, delta.tool_calls);
        }
      } catch {
        // Ignore malformed JSON (streaming artifacts)
      }
    }
  }
  
  return {
    id: uuidv4(),
    role: 'assistant',
    content: accumulatedContent,
    toolCalls,
    timestamp: new Date(),
  };
}

/**
 * OpenAI-Compatible API Format
 * 
 * Local providers (Ollama, vLLM, LM Studio) implement the OpenAI API format,
 * which means we can use the same code for cloud and local providers.
 * 
 * Key endpoints:
 * - POST /v1/chat/completions - Chat with streaming support
 * - GET /v1/models - List available models
 * - POST /v1/embeddings - Get embeddings (optional)
 * 
 * Request format (simplified):
 * {
 *   model: "llama3.1:8b",
 *   messages: [{ role: "user", content: "..." }],
 *   tools: [{ type: "function", function: { name, parameters } }],
 *   tool_choice: "auto",
 *   stream: true
 * }
 * 
 * Response format (streaming SSE):
 * data: {"choices":[{"delta":{"content":"Hello"}}]}
 * data: {"choices":[{"delta":{"content":" world"}}]}
 * data: [DONE]
 * 
 * This compatibility is why we can support both OpenAI APIs and local models
 * with minimal code changes.
 */

/**
 * Detect and auto-configure local LLM provider.
 */
export async function detectLocalProvider(): Promise<LocalLLMConfig | null> {
  // Try Ollama first (most common)
  try {
    const response = await fetch('http://localhost:11434/api/tags', {
      method: 'GET',
      signal: AbortSignal.timeout(2000),  // 2 second timeout
    });
    if (response.ok) {
      const data = await response.json();
      return {
        provider: 'ollama',
        baseUrl: 'http://localhost:11434/v1',
        model: data.models[0]?.name || 'llama3',
      };
    }
  } catch {
    // Ollama not available
  }

  // Try common vLLM port
  try {
    const response = await fetch('http://localhost:8000/v1/models', {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) {
      const data = await response.json();
      return {
        provider: 'vllm',
        baseUrl: 'http://localhost:8000/v1',
        model: data.data[0]?.id || 'default',
      };
    }
  } catch {
    // vLLM not available
  }

  return null;
}

/**
 * Get available models from local provider.
 */
export async function getAvailableModels(config: LocalLLMConfig): Promise<string[]> {
  if (config.provider === 'ollama') {
    const response = await fetch(`${config.baseUrl.replace('/v1', '')}/api/tags`);
    const data = await response.json();
    return data.models.map((m: any) => m.name);
  } else {
    // OpenAI-compatible API
    const response = await fetch(`${config.baseUrl}/models`);
    const data = await response.json();
    return data.data.map((m: any) => m.id);
  }
}
```

#### Configuration UI

Users should be able to configure their local LLM provider through the UI:

```typescript
// components/settings/LocalLLMSettings.tsx

export function LocalLLMSettings() {
  const [config, setConfig] = useState<LocalLLMConfig | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);

  const handleDetectProvider = async () => {
    setIsDetecting(true);
    const detected = await detectLocalProvider();
    if (detected) {
      setConfig(detected);
      setModels(await getAvailableModels(detected));
    } else {
      alert('No local LLM server detected. Please ensure Ollama or vLLM is running.');
    }
    setIsDetecting(false);
  };

  return (
    <div className="local-llm-settings">
      <h3>Local LLM Configuration</h3>
      
      {!config ? (
        <button onClick={handleDetectProvider} disabled={isDetecting}>
          {isDetecting ? 'Detecting...' : 'Auto-Detect Local Server'}
        </button>
      ) : (
        <div className="config-form">
          <div className="field">
            <label>Provider</label>
            <span className="value">{config.provider}</span>
          </div>
          
          <div className="field">
            <label>Base URL</label>
            <input
              type="text"
              value={config.baseUrl}
              onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
            />
            <small>Default: {config.provider === 'ollama' ? 'http://localhost:11434/v1' : 'http://localhost:8000/v1'}</small>
          </div>
          
          <div className="field">
            <label>Model</label>
            <select
              value={config.model}
              onChange={(e) => setConfig({ ...config, model: e.target.value })}
            >
              {models.map((model) => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
          </div>
          
          <div className="field">
            <label>Temperature</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={config.temperature ?? 0.7}
              onChange={(e) => setConfig({ ...config, temperature: parseFloat(e.target.value) })}
            />
            <span>{config.temperature ?? 0.7}</span>
          </div>
          
          <button onClick={handleDetectProvider}>Re-Detect</button>
        </div>
      )}
      
      <div className="help-text">
        <h4>Quick Start</h4>
        <p><strong>Ollama:</strong> Install from ollama.com, then run <code>ollama run llama3</code></p>
        <p><strong>vLLM:</strong> Install with pip, then run <code>vllm serve llama-3-8b-instruct</code></p>
        <p>Both will start an OpenAI-compatible API server locally.</p>
      </div>
    </div>
  );
}
```

#### Model Recommendations

Different models work better for different use cases:

| Model | Parameters | Strengths | Weaknesses | Best For |
|-------|-------------|------------|-------------|----------|
| **Llama 3.1 8B** | 8B | Good balance, fast, strong reasoning | Limited by context window | General tasks, account management |
| **Llama 3.1 70B** | 70B | Excellent reasoning, good with tools | Slower, needs powerful GPU | Complex analysis, multi-step planning |
| **Mistral Nemo 12B** | 12B | Fast, good at following instructions | Less nuanced than 70B models | Scenarios, assumption overrides |
| **Codestral** | 22B | Excellent at tool calling, structured output | Overkill for simple tasks | Complex multi-action operations |
| **Qwen 2.5 32B** | 32B | Strong math, financial reasoning | English quality slightly lower | Calculations, tax analysis |
| **Gemma 2 27B** | 27B | Very fast, good quality | Smaller context than alternatives | General use on modest hardware |

```typescript
// ai/local/model-recommendations.ts

export interface ModelRecommendation {
  model: string;
  description: string;
  minRam: string;
  minVram: string;
  speed: 'fast' | 'medium' | 'slow';
  capabilities: string[];
}

export const RECOMMENDED_MODELS: Record<string, ModelRecommendation> = {
  'llama3.1:8b': {
    model: 'llama3.1:8b',
    description: 'Best balance of speed and quality for most tasks. Requires ~16GB RAM.',
    minRam: '16GB',
    minVram: '8GB',
    speed: 'fast',
    capabilities: ['account-management', 'basic-analysis', 'scenario-creation'],
  },
  'llama3.1:70b': {
    model: 'llama3.1:70b',
    description: 'Excellent reasoning for complex analysis. Requires ~64GB RAM or GPU.',
    minRam: '64GB',
    minVram: '40GB',
    speed: 'slow',
    capabilities: ['complex-analysis', 'multi-step-planning', 'tax-optimization'],
  },
  'mistral-nemo:12b': {
    model: 'mistral-nemo:12b',
    description: 'Fast and great at following instructions for scenarios.',
    minRam: '24GB',
    minVram: '12GB',
    speed: 'fast',
    capabilities: ['scenario-creation', 'assumption-override', 'forecast-analysis'],
  },
};
```

#### Hardware Requirements

| RAM | Recommended Models | Performance |
|-----|-------------------|--------------|
| 16GB | Llama 3.1 8B, Mistral Nemo 12B (quantized) | Good for most tasks |
| 32GB | Llama 3.1 8B, Mistral Nemo 12B, Qwen 2.5 14B | Fast response times |
| 64GB | Llama 3.1 70B (quantized), Qwen 2.5 32B | Excellent for complex tasks |
| 64GB + GPU | Any model with GPU acceleration | Production-grade performance |

#### Privacy Benefits

With local models, **no financial data ever leaves your device**:

```
Your Browser (with PF Planner)
    ↓
Your Local LLM (running on your machine)
    ↓
Your Data stays on your device
```

This is ideal for:
- **Privacy-conscious users** who don't trust cloud APIs
- **Sensitive financial data** that shouldn't leave the device
- **Regulated environments** where data cannot be transmitted
- **Offline operation** - work from anywhere with full AI capabilities

#### Limitations

| Limitation | Mitigation |
|------------|------------|
| **Hardware requirements** | Use quantized models; start with smaller models |
| **Slower than cloud** | Use GPU acceleration; optimized models |
| **No model updates** | Users manually pull new models via `ollama pull` |
| **Less capable than GPT-4/Claude** | Use larger models (70B+) for complex tasks |

#### Integration with Backend (Future)

When backend is added, local model option remains available:

```typescript
// ai/client/adapter.ts (updated)

export async function chatWithAI(
  messages: ChatMessage[],
  provider: LLMProvider,
  config?: LLMConfig
): Promise<ChatMessage> {
  switch (provider) {
    case 'client':
      return await clientSideChat(messages, config?.apiKey);
    case 'server':
      return await serverSideChat(messages);
    case 'local':
      return await localChat(messages, config?.localConfig);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
```

---

## 7. Implementation Phases

### Phase 1: Foundation (4-6 weeks)

**Goal:** Basic chat interface with account management actions

| Task | Description |
|------|-------------|
| AI Client Setup | Integrate Vercel AI SDK, basic chat UI |
| Tool Export | Generate tool schemas from existing actions |
| Context Builder | Summarize current state for LLM |
| Account Tools | Wire up account CRUD actions |
| Basic Forecast | Run forecast and return summary |
| Local Model Support | Add Ollama/vLLM adapter, auto-detection, and configuration UI |

**Deliverables:**
- Chat panel with message history
- AI can create/update/delete accounts
- AI can run basic forecasts
- Tool call visualization
- Support for OpenAI, Anthropic, and local LLM providers
- Auto-detection of local model servers (Ollama, vLLM)

### Phase 2: Scenarios & Assumptions (3-4 weeks)

**Goal:** Enable scenario creation and assumption management

| Task | Description |
|------|-------------|
| Scenario Tools | Create/edit/delete scenarios |
| Assumption Tools | Override assumptions in scenarios |
| Query Layer | Summarize financial position, compare scenarios |
| Context Expansion | Include scenarios in context |

**Deliverables:**
- AI can create "what if" scenarios
- AI can modify assumptions for time periods
- AI can compare scenarios
- Smart suggestions for reasonable assumptions

### Phase 3: Analysis & Insights (4-6 weeks)

**Goal:** AI can perform sophisticated analysis and make recommendations

| Task | Description |
|------|-------------|
| Query Actions | Find funding sources, suggest accounts, validate changes |
| Analysis Tools | Retirement readiness, risk assessment, sensitivity analysis |
| Proactive Suggestions | AI detects issues and suggests improvements |
| Multi-Step Planning | AI chains actions to achieve complex goals |

**Deliverables:**
- AI can answer "when can I retire" with analysis
- AI suggests optimizations (tax efficiency, asset allocation)
- AI validates changes before applying
- AI handles complex multi-turn conversations

### Phase 4: Backend & Cloud Storage (Future)

**Goal:** Add optional cloud storage and backend services while maintaining local mode option

| Task | Description |
|------|-------------|
| API Routes | Backend for cloud storage API, auth |
| Supabase Integration | Database, auth providers |
| Authentication | User accounts (email/password, OAuth) |
| Cloud Storage Mode | Alternative to IndexedDB for data persistence |
| Export/Import | Move between local and cloud modes |
| Server LLM Proxy | Optional: manage API keys for convenience |

**Deliverables:**
- Users can choose local (IndexedDB) or cloud (Supabase) storage
- Auth flows for cloud mode
- Cloud plans accessible from any device
- Export/import utilities for cross-mode migration
- Repository pattern maintains clean separation

**NOT included in Phase 4:**
- Real-time collaboration/sync (remains off roadmap)
- Multi-user scenarios (single-user design continues)

---

## 8. Key Considerations

### 8.1 Privacy & Security

**Cloud providers (OpenAI, Anthropic):**
- User provides their own API key (stored in IndexedDB)
- Data transmitted to provider's servers
- User controls when data is sent

**Local providers (Ollama, vLLM):**
- **Zero data leaves device** - all processing happens locally
- No API keys needed
- Complete privacy for sensitive financial information
- Works fully offline

**Future (with backend):**
- Option to encrypt data at rest
- Zero-knowledge encryption where possible
- Clear privacy policy
- User control over data export/deletion

### 8.2 Model Selection & Performance

Choosing the right model is critical for user experience:

```typescript
// ai/model-selector.ts

export interface ModelCapabilities {
  requiresInternet: boolean;
  tokenLimit: number;
  maxToolCalls: number;
  reasoningStrength: 'low' | 'medium' | 'high';
  recommendedFor: string[];
}

export const MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
  'gpt-4o': {
    requiresInternet: true,
    tokenLimit: 128000,
    maxToolCalls: 50,
    reasoningStrength: 'high',
    recommendedFor: ['complex-analysis', 'multi-step-planning', 'tax-optimization'],
  },
  'llama3.1:8b': {
    requiresInternet: false,
    tokenLimit: 8192,
    maxToolCalls: 10,
    reasoningStrength: 'medium',
    recommendedFor: ['account-management', 'basic-scenarios', 'assumption-changes'],
  },
  'llama3.1:70b': {
    requiresInternet: false,
    tokenLimit: 32768,
    maxToolCalls: 30,
    reasoningStrength: 'high',
    recommendedFor: ['complex-analysis', 'multi-step-planning'],
  },
};
```

**Automatic model fallback:**
If user selects local model but it's not available:

```typescript
export async function selectBestAvailableModel(
  task: string,
  userPreference?: string
): Promise<string> {
  if (userPreference) {
    // Try user's preferred model first
    const available = await isModelAvailable(userPreference);
    if (available) return userPreference;
  }

  // Auto-select based on task
  const taskRequirements = analyzeTaskRequirements(task);
  
  if (taskRequirements.complexity === 'high') {
    // Prefer GPT-4o or large local model
    return await selectModel(['gpt-4o', 'llama3.1:70b']);
  } else {
    // Smaller models are sufficient
    return await selectModel(['llama3.1:8b', 'mistral-nemo:12b']);
  }
}
```

### 8.3 Streaming Support

Both cloud and local LLMs support streaming responses, providing a better user experience:

**Benefits:**
- **Faster perceived response time**: Users see text appear as it's generated
- **Better interactivity**: Users can interrupt long responses
- **Progress feedback**: Users know the AI is working
- **Tool call transparency**: See each tool call as it happens

```typescript
// ai/streaming/handler.ts

export interface StreamingHandler {
  onContentChunk(chunk: string): void;
  onToolCall(call: ToolCall): void;
  onToolResult(result: any): void;
  onComplete(message: ChatMessage): void;
  onError(error: Error): void;
}

export async function streamChatResponse(
  messages: ChatMessage[],
  handler: StreamingHandler,
  config: LLMConfig
): Promise<void> {
  try {
    const response = await fetchLLMEndpoint(messages, config);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    
    let buffer = '';
    let content = '';
    let toolCalls: ToolCall[] = [];
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        const parsed = parseSSELine(line);
        
        if (parsed.type === 'content') {
          content += parsed.data;
          handler.onContentChunk(parsed.data);
        } else if (parsed.type === 'tool_call') {
          toolCalls = mergeToolCalls(toolCalls, parsed.data);
          handler.onToolCall(parsed.data);
        }
      }
    }
    
    handler.onComplete({
      id: uuidv4(),
      role: 'assistant',
      content,
      toolCalls,
      timestamp: new Date(),
    });
  } catch (error) {
    handler.onError(error);
  }
}
```

**Streaming UI Updates:**
```tsx
function StreamingMessage() {
  const [content, setContent] = useState('');
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  
  useEffect(() => {
    let cancelled = false;
    
    streamChatResponse(messages, {
      onContentChunk: (chunk) => {
        if (!cancelled) setContent(prev => prev + chunk);
      },
      onToolCall: (call) => {
        if (!cancelled) setToolCalls(prev => [...prev, call]);
      },
      onComplete: (message) => {
        // Message complete - finalize
      },
      onError: (error) => {
        // Show error
      },
    });
    
    return () => { cancelled = true; };
  }, [messages]);
  
  return (
    <div className="message-assistant">
      <div className="content">{content}</div>
      <ToolCallList toolCalls={toolCalls} />
      {!content && <TypingIndicator />}
    </div>
  );
}
```

### 8.4 Offline Capability

```typescript
// ai/offline-mode.ts

export function isOnline(): boolean {
  return navigator.onLine;
}

export async function chatWithAI(messages: ChatMessage[]): Promise<ChatMessage> {
  if (!isOnline()) {
    return {
      role: 'assistant',
      content: "I'm currently offline. Some features require an internet connection, but I can still help you manage your accounts and view your forecast.",
      timestamp: new Date(),
    };
  }
  
  return await onlineChat(messages);
}
```

### 8.5 Token Management

LLM context windows have limits. We need to:

1. **Summarize aggressively**: Don't send raw account data; send summaries
2. **Trim history**: Keep recent N messages, summarize older ones
3. **Prioritize current state**: Recent context > full history
4. **Dynamic budgeting**: Adjust context based on complexity

```typescript
// ai/context/token-manager.ts

interface TokenBudget {
  systemPrompt: number;
  currentContext: number;
  userMessage: number;
  availableForResponse: number;
}

export function allocateTokenBudget(
  totalTokens: number,
  conversationLength: number
): TokenBudget {
  // Allocate based on conversation complexity
  const complexity = Math.min(conversationLength / 10, 1);
  
  return {
    systemPrompt: 500,
    currentContext: Math.floor(4000 * (1 - complexity * 0.3)),
    userMessage: 1000,
    availableForResponse: totalTokens - 500 - 4000 - 1000,
  };
}
```

### 8.6 Error Handling

The AI should gracefully handle errors:

```typescript
// ai/error-handling.ts

export async function executeToolCallSafely(
  toolCall: ToolCall
): Promise<ToolResult> {
  try {
    const result = await executeToolCall(toolCall);
    return { status: 'success', result };
  } catch (error) {
    if (error instanceof ValidationError) {
      return {
        status: 'error',
        error: `Validation failed: ${error.message}`,
        recovery: suggestFix(error),
      };
    }
    
    if (error instanceof NetworkError) {
      return {
        status: 'error',
        error: 'Network error - please check your connection',
        retryable: true,
      };
    }
    
    return {
      status: 'error',
      error: 'Something went wrong. Please try again or contact support.',
    };
  }
}

function suggestFix(error: ValidationError): string {
  // Suggest how to fix the validation error
  // e.g., "The account 'Investment Property' needs an initial value"
}
```

### 8.7 User Preferences

Users should be able to customize AI behavior:

```typescript
// schemas/settings.ts

export interface AIPreferences {
  provider: 'openai' | 'anthropic' | 'custom' | 'local';
  apiKey?: string; // Stored securely (not used for local provider)
  localConfig?: LocalLLMConfig; // Configuration for local models
  model?: string;
  temperature?: number; // 0-1, higher = more creative
  autoConfirm?: boolean; // Skip confirmations for non-destructive actions
  showToolCalls?: boolean; // Show detailed tool execution
  explanationDetail?: 'minimal' | 'normal' | 'detailed';
  defaultAssumptions?: {
    investmentGrowth: number;
    propertyGrowth: number;
    inflation: number;
  };
}
```

---

## 9. Testing Strategy

### 9.1 Unit Tests

Test each action/tool in isolation:

```typescript
// actions/tools/createAccount.test.ts

describe('createAccount tool', () => {
  it('should create a valid account from AI input', async () => {
    const input = {
      name: 'Salary',
      type: 'income',
      initialValue: 100000,
      // ... other fields
    };
    
    const result = await createAccount(input);
    
    expect(result.id).toBeDefined();
    expect(result.name).toBe('Salary');
    expect(result.type).toBe('income');
  });
});
```

### 9.2 Integration Tests

Test conversation flows:

```typescript
// ai/integration/scenario-creation.test.ts

describe('AI scenario creation', () => {
  it('should create a market downturn scenario', async () => {
    const conversation = [
      { role: 'user', content: 'Create a scenario with a market downturn in 2030 lasting 4 years' },
    ];
    
    const response = await chatWithAI(conversation);
    
    expect(response.toolCalls).toContainEqual(
      expect.objectContaining({
        name: 'createScenario',
        arguments: expect.objectContaining({
          name: expect.stringContaining('market downturn'),
        }),
      })
    );
    
    expect(response.toolCalls).toContainEqual(
      expect.objectContaining({
        name: 'setAssumptionOverride',
      })
    );
  });
});
```

### 9.3 E2E Tests

Test end-to-end user experiences with Playwright:

```typescript
// e2e/ai-chat.spec.ts

test('user can ask about retirement readiness', async ({ page }) => {
  await page.goto('/');
  await page.click('[data-testid="chat-button"]');
  
  await page.fill('[data-testid="chat-input"]', 'When can I retire with $80K/year?');
  await page.click('[data-testid="send-button"]');
  
  // Wait for AI response
  await page.waitForSelector('.message-assistant');
  
  // Verify response content
  const response = await page.textContent('.message-assistant');
  expect(response).toContain('retire');
  expect(response).toMatch(/\$\d{2},\d{3}/); // Dollar amount
});
```

---

## 10. Success Metrics

| Metric | Target | How to Measure |
|--------|--------|---------------|
| **Task completion rate** | >80% | % of user requests successfully completed |
| **Average turns per task** | <5 | Average conversation turns to complete a task |
| **User satisfaction** | >4/5 | In-app rating after complex tasks |
| **Error recovery** | >90% | % of errors that AI can recover from automatically |
| **Tool accuracy** | >95% | % of tool calls with correct parameters |
| **Context retention** | >90% | % of conversations where AI remembers context |

---

## 11. Open Questions

- [ ] Which LLM provider to use as default? (OpenAI GPT-4o vs Anthropic Claude 3.5 Sonnet vs local models)
- [ ] How to handle rate limits with client-side API keys?
- [ ] Should we auto-detect local models or require manual configuration?
- [ ] How to balance helpfulness vs. verbosity in AI responses?
- [ ] Should AI proactively suggest optimizations even when not asked?
- [ ] How to handle conflicting instructions across conversation?
- [ ] What's the minimum acceptable performance for local model support?

---

## 12. Next Steps

1. Review and refine this planning document
2. Create detailed user stories for Phase 1
3. Set up AI client integration (Vercel AI SDK)
4. Implement tool schema generation from actions
5. Build basic chat UI
6. Wire up account management tools
7. Add local model support (Ollama/vLLM adapter)
8. Test with multiple local models and configurations
9. Write integration tests for key conversation flows

---

## Appendix: Example Tool Schema

```json
{
  "name": "createAccount",
  "description": "Create a new financial account (income, expense, asset, or liability). Use this when the user wants to add a new financial item to their plan.",
  "parameters": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "description": "Human-readable name for the account (e.g., 'Salary', 'Investment Property', 'Mortgage')"
      },
      "type": {
        "type": "string",
        "enum": ["income", "expense", "asset", "liability"],
        "description": "The type of account"
      },
      "initialValue": {
        "type": "number",
        "description": "Starting value for the account (for assets and liabilities)"
      },
      "growthProfile": {
        "type": "object",
        "description": "How the account value changes over time",
        "properties": {
          "type": {
            "type": "string",
            "enum": ["fixed", "cpiLinked", "increasing", "decreasing"]
          },
          "rate": {
            "type": "number",
            "description": "Growth rate (e.g., 0.07 for 7%)"
          }
        }
      }
    },
    "required": ["name", "type"]
  }
}
```
