import { ApiPromise, WsProvider } from "@polkadot/api";
import * as Keyring from "@polkadot/keyring";
import * as Util from "@polkadot/util";
import Web3 from "web3";

import {
  getW3,
  getClaimsContract,
  getFrozenTokenContract,
  getTokenHolderData,
  getClaimers,
} from "./helpers";

const w3Util = new Web3().utils;

const Decimals = 10 ** 9;
const VestingLength = w3Util.toBN(Math.ceil(24 * 30 * 24 * 60 * (60 / 6)));

const getApi = (endpoint: string): Promise<ApiPromise> => {
  const provider = new WsProvider(endpoint);

  return ApiPromise.create({
    provider,
  });
};

const verify = async (cmd: any) => {
  const { atBlock, claims, endpoint } = cmd;

  console.log(`Verifying the new chain state against the Ethereum contracts.`);

  const api = await getApi(endpoint);

  const [chain, nodeName, nodeVersion] = await Promise.all([
    api.rpc.system.chain(),
    api.rpc.system.name(),
    api.rpc.system.version(),
  ]);

  console.log(`Connected to ${chain} using ${nodeName} v${nodeVersion}.`);

  console.log("Fetching data from Ethereum.");
  const w3 = getW3();
  const toBN = w3.utils.toBN;
  const dotClaims = getClaimsContract(w3, claims);
  const alloIndicator = getFrozenTokenContract(w3);

  const tokenHolders = await getTokenHolderData(alloIndicator, dotClaims);

  const [holders, claimers] = getClaimers(tokenHolders);

  for (const [ethAddr, holder] of holders) {
    const { balance, vested } = holder;

    const claim = await api.query.claims.claims(ethAddr);
    const balStr = balance.mul(toBN(Decimals)).toString();
    if (claim.toString() !== balStr) {
      throw `Claims error: Got ${claim.toString()} expected ${balStr}`;
    }

    if (vested.gt(toBN(0))) {
      const vesting = await api.query.claims.vesting(ethAddr);
      // console.log(vesting.toJSON());
      const vJson = vesting.toJSON() as any;
      const amount = toBN(vJson[0]);
      const perBlock = vested.mul(toBN(Decimals)).divRound(VestingLength);
      if (vested.mul(toBN(Decimals)).toString() !== amount.toString()) {
        throw `Mismatch: expected ${vested
          .mul(toBN(Decimals))
          .toString()} but got ${amount.toString()}`;
      }

      const rPerBlock = toBN(vJson[1]);
      if (perBlock.toString() !== rPerBlock.toString()) {
        if (perBlock.sub(rPerBlock).gt(toBN(1))) {
          throw `Mismatch (perBlock): expected ${perBlock.toString()} but got ${rPerBlock.toString()}`;
        }
      }
    }

    console.log(`OK ${ethAddr}`);
  }

  for (const [pubkey, claimer] of claimers) {
    const { balance, index, vested } = claimer;
    const encoded = Keyring.encodeAddress(Util.hexToU8a(pubkey), 0);

    const retBal = await api.query.system.account(encoded);
    if (
      retBal.data.free.toString() !== balance.mul(toBN(Decimals)).toString()
    ) {
      throw `Balance Mismatch: Expected ${balance.mul(
        toBN(Decimals)
      )} but got ${retBal.data.free.toString()}`;
    }

    const indexResult = await api.query.indices.accounts(index);
    const account = (indexResult.toJSON() as any)[0];
    if (account !== encoded) {
      throw `Index mismatch: Expected ${encoded} but got ${account}`;
    }

    if (vested.gt(toBN(0))) {
      const vesting = await api.query.vesting.vesting(encoded);
      const { locked, perBlock } = vesting.toJSON() as any;

      if (toBN(locked).toString() !== vested.mul(toBN(Decimals)).toString()) {
        throw `Vesting mismatch: expected ${vested
          .mul(toBN(Decimals))
          .toString()} but got ${toBN(locked).toString()}`;
      }

      // TODO: Check per block
      const checkPerBlock = vested.mul(toBN(Decimals)).divRound(VestingLength);
      if (toBN(perBlock).toString() !== checkPerBlock.toString()) {
        if (toBN(perBlock).sub(checkPerBlock).gt(toBN(1))) {
          throw `Vesting per block mismatch: expected ${checkPerBlock.toString()} got ${toBN(
            perBlock
          ).toString()}`;
        }
      }
    }

    console.log(`OK: ${encoded}`);
  }

  console.log(`ALL OK`);
  process.exit(1);
};

export default verify;
