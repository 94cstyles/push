"use strict";

const program = require('commander');

program
    .version('0.0.1')
    .option('-p, --path <url>', '请求连接地址')
    .option('-a, --amount <n>', '总连接数,默认1000')
    .option('-c, --concurency <n>', '每秒连接数,默认100')
    .option('-w, --worker <n>', '进程数量,默认1')
    .option('-t, --time <n>', '信息接收最长花费事件,默认10000ms')
    .option('-o, --output <file>', '输出文件')
    .parse(process.argv);

if (!program.amount) {
    program.amount = 1000;
}

if (!program.concurency) {
    program.concurency = 100;
}

if (!program.worker) {
    program.worker = 1;
}

if (!program.time) {
    program.time = 10000;
}

if (program.output) {
    program.output = require('path').resolve(__dirname, program.output);
    require('fs').createWriteStream(program.output);
}

var options = {
    path: program.path,
    amount: program.amount,
    concurency: program.concurency,
    worker: program.worker,
    output: program.output,
    time: program.time
};

if (options.path) {
    //整数处理
    options.concurency = parseInt(options.concurency / options.worker);
    options.amount = parseInt(options.amount / options.concurency) * options.concurency;
    require('./create.js')(options);
} else {
    console.error('请输入请求连接地址');
}
