import merge from 'lodash.merge'
import { pipe } from '../utils.js'
import cliProgress from 'cli-progress'
import { writeToFile } from '../writeToFile.js'
import { chromium } from 'playwright-chromium'

const TRADING_VIEW_MYX = 'MYX'
export const MYX_FILENAME = 'summary/MYX.txt'

const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic)

async function scrapBursaMalaysia() {
  const scrapUrl = ({ per_page, page }) =>
    `https://www.bursamalaysia.com/market_information/equities_prices?legend[]=[S]&sort_by=short_name&sort_dir=asc&page=${page}&per_page=${per_page}`

  try {
    const browser = await chromium.launch()
    const page = await browser.newPage()
    await page.goto(scrapUrl({ page: 1, per_page: 50 }))

    // getting max size of syariah list by grabbing the value in pagination btn
    const maxPageNumbers = await page.evaluate(() => {
      const paginationBtn = Array.from(document.querySelectorAll('.pagination li [data-val]'))
        .map(i => i.textContent)
        .filter(Boolean)
        .map(parseFloat)

      return Math.max(...paginationBtn)
    })

    let syariahList = {}
    progressBar.start(maxPageNumbers, 0)

    // grab all syariah list and navigate to each pages.
    for (let i = 1; i <= maxPageNumbers; i++) {
      await page.goto(scrapUrl({ page: i, per_page: 50 }), { waitUntil: 'networkidle' })

      const temp = await page.evaluate(() => {
        const pipe = (...fn) => initialVal => fn.reduce((acc, fn) => fn(acc), initialVal)
        const removeSpaces = pipe(name => name.replace(/\s/gm, ''))
        const removeSpacesAndShariah = pipe(removeSpaces, name => name.replace(/\[S\]/gim, ''))

        return Array.from(document.querySelectorAll('.dataTables_scrollBody table tbody tr')).reduce((acc, tr) => {
          const s = tr.querySelector(':nth-child(2)').textContent
          const stockCode = tr.querySelector(':nth-child(3)').textContent

          const code = removeSpaces(stockCode)
          const stockName = removeSpacesAndShariah(s)
          return {
            ...acc,
            [code]: {
              s: 1,
              code,
              stockName,
            },
          }
        }, {})
      })

      syariahList = { ...syariahList, ...temp }
      progressBar.increment()
    }

    await browser.close()

    // eslint-disable-next-line no-console
    console.log('\n\nFound: ', Object.keys(syariahList).length)

    return syariahList
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Error scrap data', e)
    process.exit(1)
  }
}

export function myxFilenameTransformer(data, flagId = 'MYX') {
  const bufferPadRightSize = 1
  const {
    [TRADING_VIEW_MYX]: { list, shape, ...rest },
  } = data

  const maxRestLength = Math.max(...Object.keys(rest).map(i => i.length))
  const maxStockLength = Math.max(...Object.keys(list).map(i => i.length))

  function metaDataDisplayed(key, value) {
    return `${key.padEnd(maxRestLength + bufferPadRightSize, ' ')}: ${value}`
  }

  function listDisplayed(stockName, values) {
    const stockIs = values
      .map((binary, index) => (Boolean(binary) ? shape[index] : null))
      .filter(Boolean)
      .join(', ')

    return `${stockName.padEnd(maxStockLength + bufferPadRightSize, ' ')}: ${stockIs}`
  }

  function dash(size = 20, char = '-') {
    return Array.from({ length: size }, () => char).join('')
  }

  return `
${flagId}
${Object.entries(rest)
  .reduce((acc, [key, value]) => acc + '\n' + metaDataDisplayed(key, value), '')
  .trim()}
${dash()}
${Object.entries(list).reduce((acc, [stockName, values]) => acc + '\n' + listDisplayed(stockName, values), '')}`.trim()
}

export async function MYX() {
  try {
    const shariahList = await scrapBursaMalaysia()

    const sortedList = pipe(
      Object.values,
      entries => entries.sort(({ stockName: keyA }, { stockName: keyB }) => (keyA < keyB ? -1 : keyA > keyB ? 1 : 0)),
      items => items.reduce((acc, { s, stockName }) => ({ ...acc, [stockName]: [s] }), {})
    )(merge(shariahList)) // merge by stock code

    const NEW_MYX_DATA = {
      [TRADING_VIEW_MYX]: {
        updatedAt: new Date(),
        shape: ['s'],
        list: sortedList,
      },
    }

    // write to MYX
    await writeToFile(MYX_FILENAME, myxFilenameTransformer(NEW_MYX_DATA))

    return NEW_MYX_DATA
  } catch (e) {
    throw `Error generating ${TRADING_VIEW_MYX}`
  }
}
