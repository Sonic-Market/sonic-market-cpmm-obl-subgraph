import {
  Address,
  BigDecimal,
  BigInt,
  Bytes,
  ethereum,
} from '@graphprotocol/graph-ts'

import { PairCreated } from '../../generated/Factory/Factory'
import {
  Burn,
  Mint,
  Pair as PairContract,
  Swap,
  Sync,
  Transfer,
} from '../../generated/templates/Pair/Pair'
import {
  LPPositionSnapshot,
  Pool,
  Pools,
  PoolSnapshot,
  Trade,
  Users,
  UserScoreSnapshot,
  V2Burn,
  V2Mint,
  V2Sync,
  V2Transfer,
} from '../../generated/schema'
import { Pair as PairTemplate } from '../../generated/templates'
import { ERC20 } from '../../generated/Factory/ERC20'

const CHAIN_ID = BigInt.fromI32(1)
const ZERO_BI = BigInt.fromI32(0)
const ONE_BI = BigInt.fromI32(1)
const ZERO_BD = BigDecimal.fromString('0')
const FEE_RATE = BigDecimal.fromString('0.003')
const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000'
export const POOLS = 'pools'
export const USERS = 'users'

function createBlockDate(timestamp: BigInt): string {
  const date = new Date(timestamp.toI32() * 1000)
  return date.toISOString().split('T')[0]
}

function updatePoolDailySnapshotVolume(event: Swap): void {
  const snapshotId =
    createBlockDate(event.block.timestamp) + '-' + event.address.toHexString()
  let snapshot = PoolSnapshot.load(snapshotId)
  let snapshot1 = PoolSnapshot.load(snapshotId + '-1')

  if (!snapshot || !snapshot1) {
    const pool = Pool.load(event.address.toHexString())
    if (!pool) {
      return
    }
    createPoolDailySnapshots(event.block, pool)
  }

  snapshot = PoolSnapshot.load(snapshotId)!
  snapshot1 = PoolSnapshot.load(snapshotId + '-1')!

  if (event.params.amount0In.gt(ZERO_BI)) {
    snapshot.volumeAmount = snapshot.volumeAmount.plus(
      event.params.amount0In.toBigDecimal(),
    )
  }
  if (event.params.amount0Out.gt(ZERO_BI)) {
    snapshot.volumeAmount = snapshot.volumeAmount.plus(
      event.params.amount0Out.toBigDecimal(),
    )
  }

  if (event.params.amount1In.gt(ZERO_BI)) {
    snapshot1.volumeAmount = snapshot1.volumeAmount.plus(
      event.params.amount1In.toBigDecimal(),
    )
  }
  if (event.params.amount1Out.gt(ZERO_BI)) {
    snapshot1.volumeAmount = snapshot1.volumeAmount.plus(
      event.params.amount1Out.toBigDecimal(),
    )
  }

  snapshot.save()
  snapshot1.save()
}

function createPoolDailySnapshots(block: ethereum.Block, pool: Pool): void {
  const snapshotId =
    createBlockDate(block.timestamp) + '-' + pool.poolAddress.toHexString()
  const lastSnapshot = PoolSnapshot.load(snapshotId)

  if (!lastSnapshot) {
    const pair = PairContract.bind(Address.fromBytes(pool.poolAddress))
    const reserves = pair.getReserves()

    const snapshot = new PoolSnapshot(snapshotId)
    snapshot.timestamp = block.timestamp
    snapshot.blockDate = createBlockDate(block.timestamp)
    snapshot.chainId = CHAIN_ID
    snapshot.poolAddress = pool.poolAddress
    snapshot.tokenIndex = ZERO_BI
    snapshot.tokenAddress = pair.token0()
    const token0 = ERC20.bind(pair.token0())
    snapshot.tokenSymbol = token0.symbol()
    snapshot.tokenAmount = reserves.value0.toBigDecimal()
    snapshot.volumeAmount = ZERO_BD
    snapshot.feeRate = FEE_RATE
    snapshot.save()

    const snapshot1 = new PoolSnapshot(snapshotId + '-1')
    snapshot1.timestamp = block.timestamp
    snapshot1.blockDate = createBlockDate(block.timestamp)
    snapshot1.chainId = CHAIN_ID
    snapshot1.poolAddress = pool.poolAddress
    snapshot1.tokenIndex = ONE_BI
    snapshot1.tokenAddress = pair.token1()
    const token1 = ERC20.bind(pair.token1())
    snapshot1.tokenSymbol = token1.symbol()
    snapshot1.tokenAmount = reserves.value1.toBigDecimal()
    snapshot1.volumeAmount = ZERO_BD
    snapshot1.feeRate = FEE_RATE
    snapshot1.save()
  }
}

export function handleTransfer(event: Transfer): void {
  trackUser(event.transaction.from)
  trackUser(event.params.from)
  trackUser(event.params.to)

  const transferId =
    event.transaction.hash.toHexString() + '-' + event.logIndex.toString()
  const v2Transfer = new V2Transfer(transferId)

  v2Transfer.timestamp = event.block.timestamp
  v2Transfer.chainId = CHAIN_ID
  v2Transfer.blockNumber = event.block.number
  v2Transfer.logIndex = event.logIndex
  v2Transfer.transactionHash = event.transaction.hash
  v2Transfer.transactionFromAddress = event.transaction.from
  v2Transfer.fromAddress = event.params.from
  v2Transfer.toAddress = event.params.to
  v2Transfer.poolAddress = event.address
  v2Transfer.tokenAmount = event.params.value.toBigDecimal()

  v2Transfer.save()
}

function trackPool(poolAddress: Bytes): void {
  let pools = Pools.load(POOLS)
  if (!pools) {
    pools = new Pools(POOLS)
    pools.addresses = []
  }
  const addresses = pools.addresses
  addresses.push(poolAddress)
  pools.addresses = addresses
  pools.save()
}

function trackUser(userAddress: Bytes): void {
  if (userAddress.equals(Address.fromString(ADDRESS_ZERO))) {
    return
  }

  let users = Users.load(USERS)
  if (!users) {
    users = new Users(USERS)
    users.addresses = []
  }

  const addresses = users.addresses
  for (let i = 0; i < addresses.length; i++) {
    if (addresses[i] == userAddress) {
      return
    }
  }

  addresses.push(userAddress)
  users.addresses = addresses
  users.save()
}

export function handlePairCreated(event: PairCreated): void {
  const pool = new Pool(event.params.pair.toHexString())

  pool.chainId = CHAIN_ID
  pool.creationBlockNumber = event.block.number
  pool.timestamp = event.block.timestamp
  pool.poolAddress = event.params.pair
  pool.lpTokenAddress = event.params.pair

  const pair = PairContract.bind(Address.fromBytes(event.params.pair))
  pool.lpTokenSymbol = pair.symbol()

  const token0 = ERC20.bind(Address.fromBytes(event.params.token0))
  pool.tokenAddress = event.params.token0
  pool.tokenSymbol = token0.symbol()
  pool.tokenDecimals = BigInt.fromI32(token0.decimals())
  pool.tokenIndex = ZERO_BI
  pool.feeRate = FEE_RATE
  pool.dexType = 'CPMM'

  pool.save()

  const pool1 = new Pool(event.params.pair.toHexString() + '-1')
  pool1.chainId = pool.chainId
  pool1.creationBlockNumber = pool.creationBlockNumber
  pool1.timestamp = pool.timestamp
  pool1.poolAddress = pool.poolAddress
  pool1.lpTokenAddress = pool.lpTokenAddress
  pool1.lpTokenSymbol = pool.lpTokenSymbol

  const token1 = ERC20.bind(Address.fromBytes(event.params.token1))
  pool1.tokenAddress = event.params.token1
  pool1.tokenSymbol = token1.symbol()
  pool1.tokenDecimals = BigInt.fromI32(token1.decimals())
  pool1.tokenIndex = ONE_BI
  pool.feeRate = FEE_RATE
  pool1.dexType = pool.dexType

  pool1.save()

  PairTemplate.create(event.params.pair)

  trackPool(event.params.pair)
}

export function handleMint(event: Mint): void {
  trackUser(event.transaction.from)
  trackUser(event.params.sender)

  const mintId =
    event.transaction.hash.toHexString() + '-' + event.logIndex.toString()
  const v2Mint = new V2Mint(mintId)
  const pair = PairContract.bind(Address.fromBytes(event.address))

  v2Mint.timestamp = event.block.timestamp
  v2Mint.chainId = CHAIN_ID
  v2Mint.blockNumber = event.block.number
  v2Mint.logIndex = event.logIndex
  v2Mint.transactionHash = event.transaction.hash
  v2Mint.transactionFromAddress = event.transaction.from
  v2Mint.fromAddress = event.params.sender
  v2Mint.toAddress = event.params.sender
  v2Mint.poolAddress = event.address
  v2Mint.token0Address = pair.token0()
  v2Mint.token0Amount = event.params.amount0.toBigDecimal()
  v2Mint.token1Address = pair.token1()
  v2Mint.token1Amount = event.params.amount1.toBigDecimal()
  const reserves = pair.getReserves()
  const totalSupply = pair.totalSupply().toBigDecimal()
  const burnAmount0 = v2Mint.token0Amount
  const burnAmount1 = v2Mint.token1Amount
  const mintAmountFor0 = burnAmount0
    .times(totalSupply)
    .div(reserves.value0.toBigDecimal())
  const mintAmountFor1 = burnAmount1
    .times(totalSupply)
    .div(reserves.value1.toBigDecimal())
  v2Mint.mintAmount = mintAmountFor0.gt(mintAmountFor1)
    ? mintAmountFor1
    : mintAmountFor0

  v2Mint.save()
}

export function handleBurn(event: Burn): void {
  trackUser(event.transaction.from)
  trackUser(event.params.sender)
  trackUser(event.params.to)

  const burnId =
    event.transaction.hash.toHexString() + '-' + event.logIndex.toString()
  const v2Burn = new V2Burn(burnId)
  const pair = PairContract.bind(Address.fromBytes(event.address))

  v2Burn.timestamp = event.block.timestamp
  v2Burn.chainId = CHAIN_ID
  v2Burn.blockNumber = event.block.number
  v2Burn.logIndex = event.logIndex
  v2Burn.transactionHash = event.transaction.hash
  v2Burn.transactionFromAddress = event.transaction.from
  v2Burn.fromAddress = event.params.sender
  v2Burn.toAddress = event.params.to
  v2Burn.poolAddress = event.address
  v2Burn.token0Address = pair.token0()
  v2Burn.token0Amount = event.params.amount0.toBigDecimal()
  v2Burn.token1Address = pair.token1()
  v2Burn.token1Amount = event.params.amount1.toBigDecimal()
  const reserves = pair.getReserves()
  const totalSupply = pair.totalSupply().toBigDecimal()
  v2Burn.burnAmount = v2Burn.token0Amount
    .div(reserves.value0.toBigDecimal())
    .times(totalSupply)

  v2Burn.save()
}

export function handleSwap(event: Swap): void {
  trackUser(event.transaction.from)
  trackUser(event.params.sender)
  trackUser(event.params.to)

  const tradeId =
    event.transaction.hash.toHexString() + '-' + event.logIndex.toString()
  const trade = new Trade(tradeId)
  const pair = PairContract.bind(Address.fromBytes(event.address))

  trade.timestamp = event.block.timestamp
  trade.chainId = CHAIN_ID
  trade.blockNumber = event.block.number
  trade.logIndex = event.logIndex
  trade.transactionHash = event.transaction.hash
  trade.userAddress = event.transaction.from
  trade.takerAddress = event.params.to
  trade.makerAddress = event.params.sender
  trade.poolAddress = event.address

  const token0 = pair.token0()
  const token1 = pair.token1()

  if (event.params.amount0In.gt(ZERO_BI)) {
    trade.inputTokenAddress = token0
    trade.inputTokenAmount = event.params.amount0In.toBigDecimal()
    trade.outputTokenAddress = token1
    trade.outputTokenAmount = event.params.amount1Out.toBigDecimal()

    const inputToken = ERC20.bind(Address.fromBytes(token0))
    trade.inputTokenSymbol = inputToken.symbol()

    const outputToken = ERC20.bind(Address.fromBytes(token1))
    trade.outputTokenSymbol = outputToken.symbol()
  } else {
    trade.inputTokenAddress = token1
    trade.inputTokenAmount = event.params.amount1In.toBigDecimal()
    trade.outputTokenAddress = token0
    trade.outputTokenAmount = event.params.amount0Out.toBigDecimal()

    const inputToken = ERC20.bind(Address.fromBytes(token1))
    trade.inputTokenSymbol = inputToken.symbol()

    const outputToken = ERC20.bind(Address.fromBytes(token0))
    trade.outputTokenSymbol = outputToken.symbol()
  }

  trade.pairName = trade.inputTokenSymbol + '-' + trade.outputTokenSymbol

  const reserves = pair.getReserves()
  if (trade.inputTokenAddress == token0) {
    trade.spotPriceAfterSwap = reserves.value1
      .toBigDecimal()
      .div(reserves.value0.toBigDecimal())
  } else {
    trade.spotPriceAfterSwap = reserves.value0
      .toBigDecimal()
      .div(reserves.value1.toBigDecimal())
  }

  trade.save()

  updatePoolDailySnapshotVolume(event)
}

export function handleSync(event: Sync): void {
  const syncId =
    event.transaction.hash.toHexString() + '-' + event.logIndex.toString()
  const v2Sync = new V2Sync(syncId)
  const pair = PairContract.bind(Address.fromBytes(event.address))

  v2Sync.timestamp = event.block.timestamp
  v2Sync.chainId = CHAIN_ID
  v2Sync.blockNumber = event.block.number
  v2Sync.logIndex = event.logIndex
  v2Sync.transactionHash = event.transaction.hash
  v2Sync.poolAddress = event.address
  v2Sync.token0Address = pair.token0()
  v2Sync.token0Amount = event.params.reserve0.toBigDecimal()
  v2Sync.token1Address = pair.token1()
  v2Sync.token1Amount = event.params.reserve1.toBigDecimal()

  v2Sync.save()
}

export function handleFactoryBlock(block: ethereum.Block): void {
  const pools = Pools.load(POOLS)
  if (!pools) {
    return
  }

  const addresses = pools.addresses
  for (let i = 0; i < addresses.length; i++) {
    const poolAddress = addresses[i]
    const pool = Pool.load(poolAddress.toHexString())
    if (!pool) {
      continue
    }

    createPoolDailySnapshots(block, pool)
  }
}

function createLPPositionSnapshots(
  block: ethereum.Block,
  poolAddress: Bytes,
  userAddress: Bytes,
): void {
  const blockDate = createBlockDate(block.timestamp)
  const snapshot0Id =
    blockDate +
    '-' +
    poolAddress.toHexString() +
    '-' +
    userAddress.toHexString() +
    '-0'

  if (!LPPositionSnapshot.load(snapshot0Id)) {
    const pair = PairContract.bind(Address.fromBytes(poolAddress))
    const token0Address = pair.token0()
    const token1Address = pair.token1()
    const token0 = ERC20.bind(token0Address)
    const token1 = ERC20.bind(token1Address)

    const balance = pair.balanceOf(Address.fromBytes(userAddress))
    const totalSupply = pair.totalSupply()
    const reserves = pair.getReserves()

    const userShare = balance.toBigDecimal().div(totalSupply.toBigDecimal())
    const token0Amount = reserves.value0.toBigDecimal().times(userShare)
    const token1Amount = reserves.value1.toBigDecimal().times(userShare)

    const snapshot0 = new LPPositionSnapshot(snapshot0Id)
    snapshot0.timestamp = block.timestamp
    snapshot0.blockDate = blockDate
    snapshot0.chainId = CHAIN_ID
    snapshot0.poolAddress = poolAddress
    snapshot0.userAddress = userAddress
    snapshot0.tokenIndex = ZERO_BI
    snapshot0.tokenAddress = token0Address
    snapshot0.tokenSymbol = token0.symbol()
    snapshot0.tokenAmount = token0Amount
    snapshot0.save()

    const snapshot1Id =
      blockDate +
      '-' +
      poolAddress.toHexString() +
      '-' +
      userAddress.toHexString() +
      '-1'
    const snapshot1 = new LPPositionSnapshot(snapshot1Id)
    snapshot1.timestamp = block.timestamp
    snapshot1.blockDate = blockDate
    snapshot1.chainId = CHAIN_ID
    snapshot1.poolAddress = poolAddress
    snapshot1.userAddress = userAddress
    snapshot1.tokenIndex = ONE_BI
    snapshot1.tokenAddress = token1Address
    snapshot1.tokenSymbol = token1.symbol()
    snapshot1.tokenAmount = token1Amount
    snapshot1.save()
  }
}

function createUserScoreSnapshots(
  block: ethereum.Block,
  poolAddress: Bytes,
  userAddress: Bytes,
): void {
  const blockDate = createBlockDate(block.timestamp)
  const snapshotId =
    blockDate +
    '-' +
    poolAddress.toHexString() +
    '-' +
    userAddress.toHexString()

  if (!UserScoreSnapshot.load(snapshotId)) {
    const pair = PairContract.bind(Address.fromBytes(poolAddress))
    const balance = pair.balanceOf(Address.fromBytes(userAddress))
    const totalSupply = pair.totalSupply()

    const userShare = balance.toBigDecimal().div(totalSupply.toBigDecimal())
    const reserves = pair.getReserves()
    const totalValueLocked = reserves.value0
      .toBigDecimal()
      .plus(reserves.value1.toBigDecimal())
    const totalValueLockedScore = totalValueLocked.times(userShare)

    const snapshot = new UserScoreSnapshot(snapshotId)
    snapshot.timestamp = block.timestamp
    snapshot.blockDate = blockDate
    snapshot.chainId = CHAIN_ID
    snapshot.blockNumber = block.number
    snapshot.userAddress = userAddress
    snapshot.poolAddress = poolAddress
    snapshot.totalValueLockedScore = totalValueLockedScore
    snapshot.save()
  }
}

export function handlePairBlock(block: ethereum.Block): void {
  const pools = Pools.load(POOLS)
  const users = Users.load(USERS)
  if (!pools || !users) {
    return
  }

  for (let i = 0; i < pools.addresses.length; i++) {
    const poolAddress = pools.addresses[i]

    for (let j = 0; j < users.addresses.length; j++) {
      const userAddress = users.addresses[j]
      createLPPositionSnapshots(block, poolAddress, userAddress)
      createUserScoreSnapshots(block, poolAddress, userAddress)
    }
  }
}
