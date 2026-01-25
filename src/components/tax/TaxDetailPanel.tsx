import type { TaxEvent, TaxAggregation } from '../../schemas';

interface TaxDetailPanelProps {
  year: number;
  taxEvents: TaxEvent[];
  aggregation: TaxAggregation;
  onClose: () => void;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function TaxDetailPanel({ year, taxEvents, aggregation, onClose }: TaxDetailPanelProps) {
  const incomeEvents = taxEvents.filter(e => e.type === 'incomeTax');
  const cgtEvents = taxEvents.filter(e => e.type === 'capitalGainsTax');
  const deductionEvents = taxEvents.filter(e => e.type === 'taxDeduction');
  
  const totalIncome = incomeEvents.reduce((sum, e) => sum + e.assessableAmount, 0);
  const totalCgtDiscounted = cgtEvents.reduce((sum, e) => sum + e.assessableAmount, 0);
  const totalCgtGross = cgtEvents.reduce((sum, e) => sum + (e.grossCapitalGain ?? 0), 0);
  const totalDeductions = deductionEvents.reduce((sum, e) => sum + Math.abs(e.assessableAmount), 0);
  
  return (
    <div className="fixed inset-y-0 right-0 z-50 w-96 bg-white shadow-xl border-l border-gray-200 overflow-auto">
      <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">
          Tax Details - {year}
        </h2>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-xl"
        >
          ✕
        </button>
      </div>

      <div className="p-4 space-y-6">
        {/* Summary Section */}
        <section>
          <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">
            Summary
          </h3>
          <div className="bg-gray-50 rounded-lg p-4 space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-600">Assessable Income</span>
              <span className="font-medium">{formatCurrency(totalIncome)}</span>
            </div>
            {totalCgtGross > 0 && (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Gross Capital Gains</span>
                  <span className="text-gray-500">{formatCurrency(totalCgtGross)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Discounted Capital Gains (50%)</span>
                  <span className="font-medium">{formatCurrency(totalCgtDiscounted)}</span>
                </div>
              </>
            )}
            {totalDeductions > 0 && (
              <div className="flex justify-between text-green-700">
                <span>Deductions</span>
                <span className="font-medium">-{formatCurrency(totalDeductions)}</span>
              </div>
            )}
            <div className="border-t pt-2 mt-2 flex justify-between">
              <span className="font-medium text-gray-900">Total Taxable Income</span>
              <span className="font-semibold">{formatCurrency(aggregation.totalAssessable)}</span>
            </div>
            <div className="flex justify-between text-amber-700">
              <span className="font-medium">Tax Payable</span>
              <span className="font-semibold">{formatCurrency(aggregation.calculatedTax)}</span>
            </div>
          </div>
        </section>

        {/* Income Events */}
        {incomeEvents.length > 0 && (
          <section>
            <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">
              Income
            </h3>
            <div className="space-y-2">
              {incomeEvents.map(event => (
                <div key={event.id} className="bg-white border border-gray-200 rounded-lg p-3">
                  <div className="flex justify-between">
                    <span className="text-gray-900">{event.description}</span>
                    <span className="font-medium">{formatCurrency(event.assessableAmount)}</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Assessable income
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Deductions */}
        {deductionEvents.length > 0 && (
          <section>
            <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">
              Deductions
            </h3>
            <div className="space-y-2">
              {deductionEvents.map(event => (
                <div key={event.id} className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <div className="flex justify-between">
                    <span className="text-gray-900">{event.description}</span>
                    <span className="font-medium text-green-700">-{formatCurrency(Math.abs(event.assessableAmount))}</span>
                  </div>
                  <div className="text-xs text-green-600 mt-1">
                    Reduces taxable income
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Capital Gains Events */}
        {cgtEvents.length > 0 && (
          <section>
            <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">
              Capital Gains
            </h3>
            <div className="space-y-2">
              {cgtEvents.map(event => (
                <div key={event.id} className="bg-white border border-gray-200 rounded-lg p-3">
                  <div className="flex justify-between">
                    <span className="text-gray-900">{event.sourceAccountName ?? 'Asset Sale'}</span>
                    <span className="font-medium text-amber-700">{formatCurrency(event.assessableAmount)}</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-2 space-y-1">
                    <div className="flex justify-between">
                      <span>Sale Proceeds</span>
                      <span>{formatCurrency(event.saleProceeds ?? 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Cost Base</span>
                      <span>{formatCurrency(event.costBase ?? 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Gross Gain</span>
                      <span>{formatCurrency(event.grossCapitalGain ?? 0)}</span>
                    </div>
                    <div className="flex justify-between font-medium text-gray-700">
                      <span>
                        {event.discountApplied ? 'After 50% Discount' : 'No Discount (< 12 months)'}
                      </span>
                      <span>{formatCurrency(event.assessableAmount)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Tax Calculation Details */}
        <section>
          <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">
            Tax Calculation
          </h3>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-amber-800">Tax Schedule</span>
              <span className="font-medium text-amber-900">
                {aggregation.taxSchedule === 'marginalRates' ? 'Marginal Rates' : '15% Flat Rate'}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-amber-800">Paid From</span>
              <span className="font-medium text-amber-900">{aggregation.fundedFromAccountName}</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
