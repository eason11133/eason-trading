const roundTwd=n=>Math.round(Number(n)||0);

export const DEFAULT_BROKERAGE_SETTINGS={
 feeRate:0.001425,
 feeDiscount:1,
 regularMinFee:20,
 oddLotMinFee:1,
 stockSellTaxRate:0.003,
 dayTradeSellTaxRate:0.0015,
 oddLotThreshold:1000,
 configured:false
};

export function normalizeBrokerageSettings(input={}){
 const x={...DEFAULT_BROKERAGE_SETTINGS,...(input||{})};
 for(const k of ['feeRate','feeDiscount','regularMinFee','oddLotMinFee','stockSellTaxRate','dayTradeSellTaxRate','oddLotThreshold']){
  const n=Number(x[k]);if(!Number.isFinite(n)||n<0)throw new Error(`Invalid brokerage setting: ${k}`);x[k]=n;
 }
 if(x.feeDiscount>1)throw new Error('feeDiscount must be between 0 and 1');
 x.configured=x.configured===true;
 return x;
}

export function estimateTradeCosts(input,settings={}){
 const cfg=normalizeBrokerageSettings(settings);
 const side=String(input?.side||'').toUpperCase();
 const quantity=Number(input?.quantity),price=Number(input?.price);
 if(!['BUY','SELL'].includes(side))throw new Error('side must be BUY or SELL');
 if(!Number.isFinite(quantity)||quantity<=0)throw new Error('quantity must be > 0');
 if(!Number.isFinite(price)||price<=0)throw new Error('price must be > 0');
 const gross=quantity*price;
 const oddLot=quantity<cfg.oddLotThreshold;
 const minimumFee=oddLot?cfg.oddLotMinFee:cfg.regularMinFee;
 const calculatedFee=gross*cfg.feeRate*cfg.feeDiscount;
 const brokerFee=roundTwd(Math.max(calculatedFee,minimumFee));
 const taxRate=side==='SELL'?(input.dayTrade===true?cfg.dayTradeSellTaxRate:cfg.stockSellTaxRate):0;
 const transactionTax=roundTwd(gross*taxRate);
 const cashDelta=side==='BUY'?-(gross+brokerFee):(gross-brokerFee-transactionTax);
 return {
  side,quantity,price,gross:Number(gross.toFixed(2)),oddLot,minimumFee,
  brokerFee,transactionTax,taxRate,feeRate:cfg.feeRate,feeDiscount:cfg.feeDiscount,
  totalCosts:brokerFee+transactionTax,cashDelta:Number(cashDelta.toFixed(2)),
  settingsConfigured:cfg.configured
 };
}
