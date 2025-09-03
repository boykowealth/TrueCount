import React, { useState, useEffect, useMemo } from 'react';

// Card values and suits
const CARD_VALUES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];

// Initialize 6-deck shoe
const initializeDeck = () => {
  const deck = {};
  CARD_VALUES.forEach(value => {
    deck[value] = 24; // 6 decks × 4 suits = 24 of each card
  });
  return deck;
};

// Hand evaluation utilities
const getCardValue = (card, isAce11 = true) => {
  if (card === 'A') return isAce11 ? 11 : 1;
  if (['J', 'Q', 'K'].includes(card)) return 10;
  return parseInt(card);
};

const evaluateHand = (cards) => {
  let total = 0;
  let aces = 0;
  
  for (const card of cards) {
    if (card === 'A') {
      aces++;
      total += 11;
    } else {
      total += getCardValue(card);
    }
  }
  
  // Adjust for aces
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  
  const isSoft = aces > 0 && total <= 21;
  const isBlackjack = cards.length === 2 && total === 21;
  
  return { total, isSoft, isBlackjack, isBust: total > 21 };
};

// Probability calculation engine
const calculateProbabilities = (playerCards, dealerUpCard, deck) => {
  const totalRemaining = Object.values(deck).reduce((sum, count) => sum + count, 0);
  if (totalRemaining === 0) return { winProb: 0, lossProb: 1, pushProb: 0, dealerBustProb: 0 };
  
  // Simple probability estimation (Monte Carlo simulation would be more accurate)
  const playerHand = evaluateHand(playerCards);
  const dealerCardValue = getCardValue(dealerUpCard);
  
  // Estimate dealer bust probability based on up card
  const dealerBustProbabilities = {
    2: 0.35, 3: 0.37, 4: 0.40, 5: 0.42, 6: 0.42,
    7: 0.26, 8: 0.24, 9: 0.23, 10: 0.23, 11: 0.17
  };
  
  let dealerBustProb = dealerBustProbabilities[dealerCardValue] || 0.23;
  
  // Adjust based on remaining cards (simplified)
  const lowCards = (deck['2'] + deck['3'] + deck['4'] + deck['5'] + deck['6']) / totalRemaining;
  const highCards = (deck['10'] + deck['J'] + deck['Q'] + deck['K'] + deck['A']) / totalRemaining;
  
  // More low cards remaining = higher dealer bust probability
  dealerBustProb += (lowCards - highCards) * 0.1;
  dealerBustProb = Math.max(0.1, Math.min(0.6, dealerBustProb));
  
  let winProb, lossProb, pushProb;
  
  if (playerHand.isBust) {
    winProb = 0;
    lossProb = 1;
    pushProb = 0;
  } else if (playerHand.isBlackjack) {
    // Estimate dealer blackjack probability
    const dealerBlackjackProb = dealerUpCard === 'A' ? 0.31 : (dealerCardValue === 10 ? 0.08 : 0);
    pushProb = dealerBlackjackProb;
    winProb = 1 - dealerBlackjackProb;
    lossProb = 0;
  } else {
    // Estimate win probability based on player total and dealer up card
    const playerTotal = playerHand.total;
    
    if (playerTotal >= 17) {
      winProb = dealerBustProb + (1 - dealerBustProb) * 0.4;
    } else if (playerTotal >= 12) {
      winProb = dealerBustProb + (1 - dealerBustProb) * 0.2;
    } else {
      winProb = dealerBustProb * 0.5;
    }
    
    pushProb = 0.1; // Simplified
    lossProb = 1 - winProb - pushProb;
  }
  
  return { winProb, lossProb, pushProb, dealerBustProb };
};

// Strategy recommendations
const getStrategyRecommendation = (playerCards, dealerUpCard, deck, canDouble = true, canSplit = false) => {
  const playerHand = evaluateHand(playerCards);
  const dealerValue = getCardValue(dealerUpCard);
  
  const probs = calculateProbabilities(playerCards, dealerUpCard, deck);
  
  // Calculate expected values for each action
  const standEV = probs.winProb * 1 + probs.lossProb * (-1) + probs.pushProb * 0;
  
  // Simplified hit EV calculation
  let hitEV = standEV;
  if (playerHand.total < 21) {
    const totalRemaining = Object.values(deck).reduce((sum, count) => sum + count, 0);
    let hitProb = 0;
    
    for (const [card, count] of Object.entries(deck)) {
      if (count > 0) {
        const newCards = [...playerCards, card];
        const newHand = evaluateHand(newCards);
        const cardProb = count / totalRemaining;
        
        if (newHand.isBust) {
          hitEV += cardProb * (-1 - standEV);
        } else {
          const newProbs = calculateProbabilities(newCards, dealerUpCard, { ...deck, [card]: count - 1 });
          const newStandEV = newProbs.winProb * 1 + newProbs.lossProb * (-1) + newProbs.pushProb * 0;
          hitEV += cardProb * (newStandEV - standEV);
        }
      }
    }
  }
  
  const doubleEV = canDouble ? hitEV * 2 : -Infinity;
  const splitEV = canSplit ? standEV * 0.9 : -Infinity; // Simplified
  
  const actions = [
    { action: 'STAND', ev: standEV },
    { action: 'HIT', ev: hitEV },
    { action: 'DOUBLE', ev: doubleEV },
    { action: 'SPLIT', ev: splitEV }
  ].filter(a => a.ev !== -Infinity);
  
  actions.sort((a, b) => b.ev - a.ev);
  
  return {
    recommendedAction: actions[0].action,
    expectedValues: actions.reduce((acc, a) => ({ ...acc, [a.action]: a.ev }), {}),
    standEV,
    hitEV
  };
};

// Kelly Criterion bet sizing for NEXT round
const calculateOptimalBetForNextRound = (bankroll, winProb, lossProb, payout = 1) => {
  const p = winProb;
  const q = lossProb;
  const b = payout;
  
  const kelly = (b * p - q) / b;
  const fractionalKelly = kelly * 0.5; // Use half-Kelly for reduced volatility
  
  const betSize = Math.max(1, Math.min(500, Math.floor(fractionalKelly * bankroll)));
  
  return {
    kellyFraction: kelly,
    recommendedBet: betSize,
    betPercentage: (betSize / bankroll) * 100
  };
};

const TrueCountTerminal = () => {
  const [deck, setDeck] = useState(initializeDeck);
  const [playerCards, setPlayerCards] = useState([]);
  const [dealerUpCard, setDealerUpCard] = useState('');
  const [dealerDownCard, setDealerDownCard] = useState('');
  const [bankroll, setBankroll] = useState(1000);
  const [currentBet, setCurrentBet] = useState(10);
  const [gamePhase, setGamePhase] = useState('betting'); // betting, playing, finished
  const [gameHistory, setGameHistory] = useState([]);
  
  // Calculate current probabilities and strategy
  const currentAnalysis = useMemo(() => {
    if (playerCards.length === 0 || !dealerUpCard) {
      return null;
    }
    
    const probs = calculateProbabilities(playerCards, dealerUpCard, deck);
    const strategy = getStrategyRecommendation(
      playerCards, 
      dealerUpCard, 
      deck,
      playerCards.length === 2, // can double on first two cards
      playerCards.length === 2 && playerCards[0] === playerCards[1] // can split pairs
    );
    
    return { probs, strategy };
  }, [playerCards, dealerUpCard, deck]);

  // Calculate bet sizing for NEXT round (after current hand finishes)
  const nextRoundBetting = useMemo(() => {
    if (!currentAnalysis) return null;
    return calculateOptimalBetForNextRound(bankroll, currentAnalysis.probs.winProb, currentAnalysis.probs.lossProb);
  }, [currentAnalysis, bankroll]);
  
  const addCard = (card, target) => {
    if (deck[card] <= 0) return;
    
    const newDeck = { ...deck, [card]: deck[card] - 1 };
    setDeck(newDeck);
    
    if (target === 'player') {
      setPlayerCards([...playerCards, card]);
    } else if (target === 'dealer-up') {
      setDealerUpCard(card);
    } else if (target === 'dealer-down') {
      setDealerDownCard(card);
    }
  };
  
  const removeCard = (card, target) => {
    const newDeck = { ...deck, [card]: deck[card] + 1 };
    setDeck(newDeck);
    
    if (target === 'player') {
      const cardIndex = playerCards.lastIndexOf(card);
      if (cardIndex > -1) {
        const newPlayerCards = [...playerCards];
        newPlayerCards.splice(cardIndex, 1);
        setPlayerCards(newPlayerCards);
      }
    } else if (target === 'dealer-up') {
      setDealerUpCard('');
    } else if (target === 'dealer-down') {
      setDealerDownCard('');
    }
  };
  
  const resetGame = () => {
    setDeck(initializeDeck());
    setPlayerCards([]);
    setDealerUpCard('');
    setDealerDownCard('');
    setGamePhase('betting');
  };
  
  const finishHand = (result) => {
    let payout = 0;
    const playerHand = evaluateHand(playerCards);
    
    switch(result) {
      case 'win':
        payout = currentBet;
        break;
      case 'blackjack':
        payout = currentBet * 1.5;
        break;
      case 'loss':
        payout = -currentBet;
        break;
      case 'push':
        payout = 0;
        break;
    }
    
    setBankroll(bankroll + payout);
    setGameHistory([...gameHistory, {
      playerCards: [...playerCards],
      dealerUpCard,
      dealerDownCard,
      result,
      bet: currentBet,
      payout,
      bankroll: bankroll + payout
    }]);
    
    setGamePhase('finished');
  };
  
  const totalCardsRemaining = Object.values(deck).reduce((sum, count) => sum + count, 0);
  const playerHand = evaluateHand(playerCards);
  
  return (
    <div className="h-screen bg-black text-green-400 font-mono p-2 overflow-hidden">
      <div className="h-full flex flex-col max-w-full">
        
        {/* Header */}
        <div className="border border-green-400 mb-2 p-2">
          <div className="text-center">
            <span className="text-green-300">╔════════════════════════════════════════╗</span>
            <div className="text-xl font-bold text-green-300 py-1">
              █ █ █   TRUECOUNT TERMINAL v1.0   █ █ █
            </div>
            <span className="text-green-300">╚════════════════════════════════════════╝</span>
          </div>
        </div>

        <div className="flex-1 grid grid-cols-4 gap-2 min-h-0">
          
          {/* System Status Panel */}
          <div className="border border-green-400 p-2 overflow-y-auto">
            <div className="text-green-300 text-sm mb-2">┌─ SYSTEM STATUS ─┐</div>
            
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span>BANKROLL:</span>
                <span className="text-yellow-300">${bankroll}</span>
              </div>
              <div className="flex justify-between">
                <span>BET_SIZE:</span>
                <span className="text-yellow-300">${currentBet}</span>
              </div>
              <div className="flex justify-between">
                <span>CARDS_LEFT:</span>
                <span className="text-cyan-300">{totalCardsRemaining}/312</span>
              </div>
              <div className="flex justify-between">
                <span>PHASE:</span>
                <span className="text-magenta-300">{gamePhase.toUpperCase()}</span>
              </div>
            </div>

            <div className="mt-3 text-green-300 text-sm">┌─ BET CONTROL ─┐</div>
            <div className="mt-1">
              <input
                type="range"
                min="1"
                max="500"
                value={currentBet}
                onChange={(e) => setCurrentBet(parseInt(e.target.value))}
                className="w-full h-1 bg-green-800 rounded outline-none slider-thumb"
              />
              <div className="flex justify-between text-xs text-green-600 mt-1">
                <span>$1</span>
                <span>${currentBet}</span>
                <span>$500</span>
              </div>
            </div>
            
            <div className="mt-3 space-y-1">
              <button
                onClick={resetGame}
                className="w-full bg-black border border-blue-400 text-blue-400 hover:bg-blue-900 px-2 py-1 text-xs"
              >
                [NEW_HAND]
              </button>
              <button
                onClick={() => setGamePhase('betting')}
                className="w-full bg-black border border-yellow-400 text-yellow-400 hover:bg-yellow-900 px-2 py-1 text-xs"
              >
                [RESET_CARDS]
              </button>
            </div>
          </div>
          
          {/* Card Input Terminal */}
          <div className="border border-green-400 p-2 overflow-y-auto">
            <div className="text-green-300 text-sm mb-2">┌─ CARD INPUT ─┐</div>
            
            {/* Player Cards */}
            <div className="mb-3">
              <div className="text-xs text-cyan-300 mb-1">PLAYER_HAND:</div>
              <div className="min-h-[20px] bg-gray-900 border p-1 mb-2">
                {playerCards.length > 0 ? (
                  <span className="text-white">
                    [{playerCards.map((card, index) => (
                      <span 
                        key={index}
                        onClick={() => removeCard(card, 'player')}
                        className="cursor-pointer hover:bg-red-900 px-1"
                      >
                        {card}
                      </span>
                    )).reduce((prev, curr) => [prev, ',', curr])}]
                  </span>
                ) : (
                  <span className="text-gray-600">EMPTY</span>
                )}
              </div>
              
              <div className="grid grid-cols-7 gap-1 mb-1">
                {CARD_VALUES.map(card => (
                  <button
                    key={card}
                    onClick={() => addCard(card, 'player')}
                    disabled={deck[card] === 0}
                    className={`text-xs p-1 border ${
                      deck[card] === 0 
                        ? 'border-gray-600 text-gray-600 cursor-not-allowed' 
                        : 'border-white text-white hover:bg-gray-800'
                    }`}
                  >
                    {card}
                    <br />
                    ({deck[card]})
                  </button>
                ))}
              </div>
              
              {playerCards.length > 0 && (
                <div className="text-xs text-yellow-300">
                  TOTAL: {playerHand.total}
                  {playerHand.isSoft && ' [SOFT]'}
                  {playerHand.isBlackjack && ' [BJ]'}
                  {playerHand.isBust && ' [BUST]'}
                </div>
              )}
            </div>
            
            {/* Dealer Cards */}
            <div>
              <div className="text-xs text-red-300 mb-1">DEALER_UP:</div>
              <div className="min-h-[20px] bg-gray-900 border p-1 mb-2">
                {dealerUpCard ? (
                  <span 
                    onClick={() => removeCard(dealerUpCard, 'dealer-up')}
                    className="text-white cursor-pointer hover:bg-red-900 px-1"
                  >
                    [{dealerUpCard}]
                  </span>
                ) : (
                  <span className="text-gray-600">EMPTY</span>
                )}
              </div>
              
              <div className="grid grid-cols-7 gap-1">
                {CARD_VALUES.map(card => (
                  <button
                    key={card}
                    onClick={() => addCard(card, 'dealer-up')}
                    disabled={deck[card] === 0 || dealerUpCard !== ''}
                    className={`text-xs p-1 border ${
                      deck[card] === 0 || dealerUpCard !== ''
                        ? 'border-gray-600 text-gray-600 cursor-not-allowed' 
                        : 'border-white text-white hover:bg-gray-800'
                    }`}
                  >
                    {card}
                  </button>
                ))}
              </div>
            </div>
          </div>
          
          {/* Analysis Engine */}
          <div className="border border-green-400 p-2 overflow-y-auto">
            <div className="text-green-300 text-sm mb-2">┌─ ANALYSIS ENGINE ─┐</div>
            
            {currentAnalysis ? (
              <div className="space-y-2">
                {/* Probabilities */}
                <div>
                  <div className="text-xs text-cyan-300 mb-1">PROBABILITIES:</div>
                  <div className="space-y-1 text-xs font-mono">
                    <div>WIN....{(currentAnalysis.probs.winProb * 100).toFixed(1)}%</div>
                    <div>LOSS...{(currentAnalysis.probs.lossProb * 100).toFixed(1)}%</div>
                    <div>PUSH...{(currentAnalysis.probs.pushProb * 100).toFixed(1)}%</div>
                    <div>D_BUST.{(currentAnalysis.probs.dealerBustProb * 100).toFixed(1)}%</div>
                  </div>
                </div>
                
                {/* Strategy */}
                <div>
                  <div className="text-xs text-yellow-300 mb-1">OPTIMAL_PLAY:</div>
                  <div className="text-lg font-bold text-yellow-400 mb-1 animate-pulse">{currentAnalysis.strategy.recommendedAction}</div>
                  <div className="space-y-1 text-xs font-mono">
                    <div>STAND_EV: {currentAnalysis.strategy.expectedValues.STAND?.toFixed(3)}</div>
                    <div>HIT_EV..: {currentAnalysis.strategy.expectedValues.HIT?.toFixed(3)}</div>
                    {currentAnalysis.strategy.expectedValues.DOUBLE && (
                      <div>DBL_EV..: {currentAnalysis.strategy.expectedValues.DOUBLE.toFixed(3)}</div>
                    )}
                  </div>
                </div>
                
                {/* Next Round Betting */}
                {nextRoundBetting && (
                  <div>
                    <div className="text-xs text-green-300 mb-1">NEXT_ROUND_BET:</div>
                    <div className="text-sm font-bold text-green-400">
                      OPTIMAL: ${nextRoundBetting.recommendedBet}
                    </div>
                    <div className="text-xs font-mono space-y-1">
                      <div>KELLY%: {(nextRoundBetting.kellyFraction * 100).toFixed(1)}%</div>
                      <div>RISK%.: {nextRoundBetting.betPercentage.toFixed(1)}%</div>
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      * For next hand after current result
                    </div>
                  </div>
                )}
                
                {/* Hand Results */}
                <div className="border-t border-green-600 pt-2">
                  <div className="text-xs text-magenta-300 mb-1">FINISH_HAND:</div>
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      onClick={() => finishHand('win')}
                      className="bg-black border border-green-400 text-green-400 hover:bg-green-900 px-1 py-1 text-xs"
                    >
                      [WIN]
                    </button>
                    <button
                      onClick={() => finishHand('loss')}
                      className="bg-black border border-red-400 text-red-400 hover:bg-red-900 px-1 py-1 text-xs"
                    >
                      [LOSS]
                    </button>
                    <button
                      onClick={() => finishHand('blackjack')}
                      className="bg-black border border-yellow-400 text-yellow-400 hover:bg-yellow-900 px-1 py-1 text-xs"
                    >
                      [BJ]
                    </button>
                    <button
                      onClick={() => finishHand('push')}
                      className="bg-black border border-gray-400 text-gray-400 hover:bg-gray-700 px-1 py-1 text-xs"
                    >
                      [PUSH]
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-gray-400">
                WAITING FOR INPUT...
                <div className="animate-pulse"></div>
              </div>
            )}
          </div>
          
          {/* Session Log */}
          <div className="border border-green-400 p-2 overflow-y-auto">
            <div className="text-green-300 text-sm mb-2">┌─ SESSION LOG ─┐</div>
            
            {gameHistory.length > 0 ? (
              <div className="space-y-1">
                {gameHistory.slice(-8).map((hand, index) => (
                  <div key={index} className="text-xs font-mono border-b border-gray-800 pb-1">
                    <div className="flex justify-between">
                      <span className="text-gray-400">#{gameHistory.length - 8 + index + 1}</span>
                      <span className={`font-bold ${
                        hand.result === 'win' || hand.result === 'blackjack' 
                          ? 'text-green-400' 
                          : hand.result === 'loss' 
                          ? 'text-red-400' 
                          : 'text-yellow-400'
                      }`}>
                        {hand.result.toUpperCase()}
                      </span>
                    </div>
                    <div className="text-gray-300">
                      P:[{hand.playerCards.join(',')}] D:[{hand.dealerUpCard}]
                    </div>
                    <div className="flex justify-between">
                      <span>BET: ${hand.bet}</span>
                      <span className={`${
                        hand.payout > 0 ? 'text-green-400' : hand.payout < 0 ? 'text-red-400' : 'text-yellow-400'
                      }`}>
                        {hand.payout > 0 ? '+' : ''}${hand.payout}
                      </span>
                    </div>
                    <div className="text-right text-cyan-300">BAL: ${hand.bankroll}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-gray-400">
                NO HANDS PLAYED
                <div className="animate-pulse mt-2">LOADING...</div>
              </div>
            )}
          </div>
        </div>
        
        {/* Status Bar */}
        <div className="border border-green-400 mt-2 p-1 text-xs">
          <div className="flex justify-between">
            <span className="text-cyan-300">TRUECOUNT v1.0</span>
            <span className="text-yellow-300">KELLY CRITERION ENABLED</span>
            <span className="text-magenta-300">6-DECK SHOE</span>
            <span className="text-green-300">READY</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TrueCountTerminal;